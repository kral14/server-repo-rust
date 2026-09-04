use sqlx::SqlitePool;
use crate::models::Application;
use crate::utils::add_activity_log_pro;
use crate::deploy::trigger_deployment_impl;

pub async fn git_polling_loop(db: SqlitePool) {
    println!("[INFO] Git Auto-Deploy Polling Service is running... 🕵️");
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

        let _ = sqlx::query("DELETE FROM deployments WHERE created_at < datetime('now', '-30 days')")
            .execute(&db)
            .await;

        let apps = match sqlx::query_as::<_, Application>(
            "SELECT id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, \
             build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, \
             privileged, memory_limit, cpu_limit, \
             CAST(created_at AS TEXT) as created_at, CAST(updated_at AS TEXT) as updated_at, \
             last_commit_hash, cloudflare_url, cf_worker_url, deploy_type, registry_image, \
             auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout, \
             CAST(last_auto_deploy_check AS TEXT) as last_auto_deploy_check \
             FROM applications \
             WHERE auto_deploy_enabled = 1"
        ).fetch_all(&db).await {
            Ok(list) => list,
            Err(e) => {
                eprintln!("[ERROR] Polling loop DB error: {}", e);
                continue;
            }
        };

        for app in apps {
            if app.status == "deploying" || app.status == "building" {
                continue;
            }

            let interval_mins = app.auto_deploy_interval.unwrap_or(15).max(1);
            let should_check: bool = match sqlx::query_as::<_, (i32,)>(
                "SELECT CASE WHEN last_auto_deploy_check IS NULL OR (julianday('now') - julianday(last_auto_deploy_check)) * 1440.0 >= ? THEN 1 ELSE 0 END FROM applications WHERE id = ?"
            )
            .bind(interval_mins)
            .bind(&app.id)
            .fetch_one(&db)
            .await {
                Ok((val,)) => val == 1,
                Err(_) => true,
            };

            if !should_check {
                continue;
            }

            let _ = sqlx::query("UPDATE applications SET last_auto_deploy_check = CURRENT_TIMESTAMP WHERE id = ?")
                .bind(&app.id)
                .execute(&db)
                .await;

            let timeout_secs = app.auto_deploy_timeout.unwrap_or(10).max(3).min(60) as u64;
            let deploy_type = app.deploy_type.clone().unwrap_or_else(|| "git".to_string());

            if deploy_type == "image" {
                let reg_image = match app.registry_image.clone() {
                    Some(img) if !img.is_empty() => img,
                    _ => continue,
                };

                if !reg_image.contains('/') {
                    continue;
                }

                let inspect_output = tokio::time::timeout(
                    tokio::time::Duration::from_secs(timeout_secs),
                    tokio::process::Command::new("docker")
                        .args(["manifest", "inspect", &reg_image])
                        .output()
                ).await;

                match inspect_output {
                    Ok(Ok(out)) if out.status.success() => {
                        let inspect_json = String::from_utf8_lossy(&out.stdout);
                        let mut remote_digest = String::new();
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&inspect_json) {
                            if let Some(digest) = parsed.pointer("/config/digest").and_then(|v| v.as_str()) {
                                remote_digest = digest.to_string();
                            } else if let Some(manifests) = parsed.pointer("/manifests").and_then(|v| v.as_array()) {
                                if let Some(first) = manifests.first() {
                                    if let Some(digest) = first.pointer("/digest").and_then(|v| v.as_str()) {
                                        remote_digest = digest.to_string();
                                    }
                                }
                            }
                        }

                        if !remote_digest.is_empty() {
                            match app.last_commit_hash {
                                None => {
                                    let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                                        .bind(&remote_digest)
                                        .bind(&app.id)
                                        .execute(&db)
                                        .await;
                                    add_activity_log_pro(&db, &format!("[Auto-Deploy] '{}' layihəsinin ilkin imic imzası qeyd edildi: {}", app.name, remote_digest), "info", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                                }
                                Some(ref local_digest) if local_digest != &remote_digest => {
                                    println!("[AUTO-DEPLOY] Yeni registry image versiyası tapıldı ({} -> {}), layihə: {}", local_digest, remote_digest, app.name);
                                    add_activity_log_pro(&db, &format!("[Auto-Deploy] '{}' layihəsi üçün yeni registry imici tapıldı ({} -> {}). Avtomatik yenilənmə başladılır...", app.name, local_digest, remote_digest), "success", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                                    
                                    let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                                        .bind(&remote_digest)
                                        .bind(&app.id)
                                        .execute(&db)
                                        .await;

                                    if let Err(e) = trigger_deployment_impl(db.clone(), app.id.clone(), false).await {
                                        eprintln!("[AUTO-DEPLOY ERROR] Failed to trigger deployment for {}: {}", app.name, e);
                                        add_activity_log_pro(&db, &format!("[Auto-Deploy Xətası] '{}' layihəsinin avtomatik yenilənməsi başlaya bilmədi: {}", app.name, e), "error", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    _ => {}
                }
            } else {
                if app.repo_url.is_empty() || app.repo_url.starts_with("DOCKER_IMAGE:") {
                    continue;
                }

                let gh_token: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'github_token'")
                    .fetch_optional(&db)
                    .await
                    .unwrap_or_default();

                let token_str = gh_token.as_ref().map(|t| t.0.as_str());
                let final_repo_url = crate::utils::format_github_repo_url(&app.repo_url, token_str);

                let mut temp_ssh_key: Option<String> = None;
                if final_repo_url.starts_with("git@") || final_repo_url.starts_with("ssh://") {
                    let server_row: Option<(String, Option<String>)> = sqlx::query_as("SELECT ssh_key, ssh_key_id FROM servers WHERE id = ?")
                        .bind(&app.server_id)
                        .fetch_optional(&db)
                        .await
                        .unwrap_or_default();

                    if let Some((s_key, s_key_id)) = server_row {
                        let key_content = if let Some(ref kid) = s_key_id {
                            let db_key: Option<(String,)> = sqlx::query_as("SELECT private_key FROM ssh_keys WHERE id = ?")
                                .bind(kid)
                                .fetch_optional(&db)
                                .await
                                .unwrap_or_default();
                            db_key.map(|r| r.0).unwrap_or(s_key)
                        } else {
                            s_key
                        };

                        let key_content = if key_content.contains("BEGIN ") {
                            key_content
                        } else {
                            std::fs::read_to_string(key_content.trim()).unwrap_or_default()
                        };

                        if !key_content.trim().is_empty() {
                            let kpath = std::env::temp_dir().join(format!("git_check_{}.key", uuid::Uuid::new_v4())).to_string_lossy().into_owned();
                            let normalized = key_content.replace("\r\n", "\n").replace('\r', "\n").trim().to_string() + "\n";
                            if std::fs::write(&kpath, &normalized).is_ok() {
                                #[cfg(target_os = "windows")]
                                {
                                    let id_user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
                                    let _ = std::process::Command::new("icacls").args(&[&kpath, "/inheritance:r"]).output();
                                    let _ = std::process::Command::new("icacls").args(&[&kpath, "/grant:r", &format!("{}:F", id_user)]).output();
                                }
                                #[cfg(not(target_os = "windows"))]
                                {
                                    let _ = std::process::Command::new("chmod").args(&["600", &kpath]).output();
                                }
                                temp_ssh_key = Some(kpath);
                            }
                        }
                    }
                }

                let mut cmd = tokio::process::Command::new("git");
                cmd.env("GIT_TERMINAL_PROMPT", "0");
                if let Some(ref kpath) = temp_ssh_key {
                    cmd.env("GIT_SSH_COMMAND", format!("ssh -i \"{}\" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null", kpath.replace('\\', "/")));
                }
                cmd.args(["ls-remote", &final_repo_url, &app.branch])
                   .stdout(std::process::Stdio::piped())
                   .stderr(std::process::Stdio::piped());

                let mut child = match cmd.spawn() {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[AUTO-DEPLOY ERROR] Failed to spawn git command for {}: {}", app.name, e);
                        if let Some(ref kpath) = temp_ssh_key {
                            let _ = std::fs::remove_file(kpath);
                        }
                        continue;
                    }
                };

                let mut stdout = child.stdout.take().unwrap();
                let mut stderr = child.stderr.take().unwrap();

                let wait_fut = async {
                    use tokio::io::AsyncReadExt;
                    let status = child.wait().await;
                    let mut out_buf = Vec::new();
                    let mut err_buf = Vec::new();
                    let _ = stdout.read_to_end(&mut out_buf).await;
                    let _ = stderr.read_to_end(&mut err_buf).await;
                    (status, out_buf, err_buf)
                };

                match tokio::time::timeout(tokio::time::Duration::from_secs(timeout_secs), wait_fut).await {
                    Ok((Ok(status), out_bytes, err_bytes)) => {
                        if status.success() {
                            let result_str = String::from_utf8_lossy(&out_bytes);
                            if let Some(remote_sha) = result_str.split_whitespace().next() {
                                let remote_sha = remote_sha.to_string();
                                match app.last_commit_hash {
                                    None => {
                                        let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                                            .bind(&remote_sha)
                                            .bind(&app.id)
                                            .execute(&db)
                                            .await;
                                        add_activity_log_pro(&db, &format!("[Auto-Deploy] '{}' layihəsinin ilkin Git commit imzası qeyd edildi: {}", app.name, remote_sha), "info", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                                    }
                                    Some(ref local_sha) if local_sha != &remote_sha => {
                                        println!("[AUTO-DEPLOY] Yeni commit tapıldı ({} -> {}), layihə: {}", local_sha, remote_sha, app.name);
                                        add_activity_log_pro(&db, &format!("[Auto-Deploy] '{}' layihəsi üçün yeni commit tapıldı ({} -> {}). Avtomatik yenilənmə başladılır...", app.name, local_sha, remote_sha), "success", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                                        
                                        let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                                            .bind(&remote_sha)
                                            .bind(&app.id)
                                            .execute(&db)
                                            .await;

                                        if let Err(e) = trigger_deployment_impl(db.clone(), app.id.clone(), false).await {
                                            eprintln!("[AUTO-DEPLOY ERROR] Failed to trigger deployment for {}: {}", app.name, e);
                                            add_activity_log_pro(&db, &format!("[Auto-Deploy Xətası] '{}' layihəsinin avtomatik yenilənməsi başlaya bilmədi: {}", app.name, e), "error", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                                        }
                                    }
                                    _ => {
                                        add_activity_log_pro(&db, &format!("[Auto-Deploy] '{}' yoxlanıldı. Yenilik yoxdur.", app.name), "info", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                                    }
                                }
                            }
                        } else {
                            let err_str = String::from_utf8_lossy(&err_bytes);
                            eprintln!("[AUTO-DEPLOY ERROR] git ls-remote failed for {}: {}", app.name, err_str.trim());
                            add_activity_log_pro(&db, &format!("[Auto-Deploy Xətası] '{}' üçün git ls-remote uğursuz oldu: {}", app.name, err_str.trim()), "error", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                        }
                    }
                    Ok((Err(e), _, _)) => {
                        eprintln!("[AUTO-DEPLOY ERROR] Failed to wait for git command for {}: {}", app.name, e);
                        add_activity_log_pro(&db, &format!("[Auto-Deploy Xətası] '{}' üçün Git yoxlanışı uğursuz oldu: {}", app.name, e), "error", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                    }
                    Err(_) => {
                        let _ = child.kill().await;
                        eprintln!("[AUTO-DEPLOY ERROR] git ls-remote timed out ({}s limit) for {}. Process forcefully killed.", timeout_secs, app.name);
                        add_activity_log_pro(&db, &format!("[Auto-Deploy Xətası] '{}' üçün Git sorğusu vaxt aşımına uğradı ({}s). Proses məcburi dayandırıldı.", app.name, timeout_secs), "error", Some("Auto-Deploy"), Some("system"), Some(&app.id), None).await;
                    }
                }

                if let Some(ref kpath) = temp_ssh_key {
                    let _ = std::fs::remove_file(kpath);
                }
            }
        }
    }
}
