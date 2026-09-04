use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use uuid::Uuid;
use sqlx::SqlitePool;
use crate::models::{Application, CreateApplicationInput, UpdateApplicationInput, QuickAutoDeployInput, Server};
use crate::utils::add_activity_log_pro;
use crate::AppState;
use crate::deploy::trigger_deployment_impl;

pub fn applications_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_applications).post(create_application))
        .route("/autodeploy-list", get(list_autodeploy_applications))
        .route("/check-all-deploy", post(check_all_applications_deploy))
        .route("/:app_id", get(get_application).put(update_application).delete(delete_application))
        .route("/:app_id/quick-autodeploy", post(quick_update_autodeploy))
        .route("/:app_id/stop", post(stop_application))
        .route("/:app_id/restart", post(restart_application))
        .route("/:app_id/check-deploy", post(check_application_deploy))
}

pub async fn list_applications(State(state): State<AppState>) -> Result<Json<Vec<Application>>, (StatusCode, String)> {
    let apps = match sqlx::query_as::<_, Application>(
        "SELECT id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, \
         build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, \
         privileged, memory_limit, cpu_limit, \
         CAST(created_at AS TEXT) as created_at, CAST(updated_at AS TEXT) as updated_at, \
         last_commit_hash, cloudflare_url, cf_worker_url, deploy_type, registry_image, \
         auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout, \
         CAST(last_auto_deploy_check AS TEXT) as last_auto_deploy_check \
         FROM applications \
         WHERE name NOT LIKE 'cf-tunnel-%' AND name NOT LIKE 'masterdeploy-%' AND TRIM(name) != '' \
         ORDER BY created_at DESC"
    )
    .fetch_all(&state.db)
    .await {
        Ok(apps) => apps,
        Err(e) => {
            eprintln!("[ERROR] Failed to fetch applications from DB: {}", e);
            Vec::new()
        }
    };
    Ok(Json(apps))
}

pub async fn list_autodeploy_applications(State(state): State<AppState>) -> Result<Json<Vec<Application>>, (StatusCode, String)> {
    let apps = match sqlx::query_as::<_, Application>(
        "SELECT id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, \
         build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, \
         privileged, memory_limit, cpu_limit, \
         CAST(created_at AS TEXT) as created_at, CAST(updated_at AS TEXT) as updated_at, \
         last_commit_hash, cloudflare_url, cf_worker_url, deploy_type, registry_image, \
         auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout, \
         CAST(last_auto_deploy_check AS TEXT) as last_auto_deploy_check \
         FROM applications \
         WHERE name NOT LIKE 'cf-tunnel-%' AND TRIM(name) != '' \
         ORDER BY auto_deploy_enabled DESC, created_at DESC"
    )
    .fetch_all(&state.db)
    .await {
        Ok(apps) => apps,
        Err(e) => {
            eprintln!("[ERROR] Failed to fetch autodeploy applications from DB: {}", e);
            Vec::new()
        }
    };
    Ok(Json(apps))
}

pub async fn create_application(State(state): State<AppState>, Json(input): Json<CreateApplicationInput>) -> Result<(StatusCode, Json<Application>), (StatusCode, String)> {
    if input.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Layihə adı (Service Name) boş ola bilməz!".to_string()));
    }
    let id = Uuid::new_v4().to_string();
    let bp_type = input.build_pack_type.clone().unwrap_or_else(|| "dockerfile".to_string());
    let dep_type = input.deploy_type.clone().unwrap_or_else(|| "git".to_string());
    let auto_enabled = input.auto_deploy_enabled.unwrap_or(0);
    let auto_interval = input.auto_deploy_interval.unwrap_or(15);
    let auto_timeout = input.auto_deploy_timeout.unwrap_or(10);
    
    sqlx::query(
        "INSERT INTO applications (
            id, name, repo_url, branch, port, server_id, status, env_vars,
            build_pack_type, build_command, run_command, dockerfile_path,
            entrypoint, command, target, work_dir, privileged, memory_limit, cpu_limit,
            deploy_type, registry_image,
            auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.repo_url)
    .bind(&input.branch)
    .bind(input.port)
    .bind(&input.server_id)
    .bind("stopped")
    .bind(&input.env_vars)
    .bind(&bp_type)
    .bind(&input.build_command)
    .bind(&input.run_command)
    .bind(&input.dockerfile_path)
    .bind(&input.entrypoint)
    .bind(&input.command)
    .bind(&input.target)
    .bind(&input.work_dir)
    .bind(input.privileged.unwrap_or(0))
    .bind(&input.memory_limit)
    .bind(input.cpu_limit)
    .bind(&dep_type)
    .bind(&input.registry_image)
    .bind(auto_enabled)
    .bind(auto_interval)
    .bind(auto_timeout)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let app = Application {
        id: id.clone(),
        name: input.name.clone(),
        repo_url: input.repo_url,
        branch: input.branch,
        port: input.port,
        server_id: input.server_id,
        status: "stopped".to_string(),
        env_vars: input.env_vars,
        build_pack_type: Some(bp_type),
        build_command: input.build_command,
        run_command: input.run_command,
        dockerfile_path: input.dockerfile_path,
        entrypoint: input.entrypoint,
        command: input.command,
        target: input.target,
        work_dir: input.work_dir,
        privileged: Some(input.privileged.unwrap_or(0)),
        memory_limit: input.memory_limit,
        cpu_limit: input.cpu_limit,
        last_commit_hash: None,
        cloudflare_url: None,
        cf_worker_url: None,
        deploy_type: Some(dep_type),
        registry_image: input.registry_image,
        auto_deploy_enabled: Some(auto_enabled),
        auto_deploy_interval: Some(auto_interval),
        auto_deploy_timeout: Some(auto_timeout),
        last_auto_deploy_check: None,
        created_at: String::new(),
        updated_at: String::new(),
    };

    add_activity_log_pro(&state.db, &format!("Yeni tətbiq əlavə edildi: '{}' (Port: {})", app.name, app.port), "success", Some("System"), Some("admin"), Some(&app.id), None).await;
    
    Ok((StatusCode::CREATED, Json(app)))
}

pub async fn get_application(State(state): State<AppState>, AxumPath(app_id): AxumPath<String>) -> Result<Json<Application>, (StatusCode, String)> {
    let mut app = sqlx::query_as::<_, Application>(
        "SELECT id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, \
         build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, \
         privileged, memory_limit, cpu_limit, \
         CAST(created_at AS TEXT) as created_at, CAST(updated_at AS TEXT) as updated_at, \
         last_commit_hash, cloudflare_url, cf_worker_url, deploy_type, registry_image, \
         auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout, \
         CAST(last_auto_deploy_check AS TEXT) as last_auto_deploy_check \
         FROM applications WHERE id = ?"
    )
    .bind(&app_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Application not found".to_string()))?;

    if app.status != "deploying" && app.status != "building" {
        if let Ok(Some(server)) = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
            .bind(&app.server_id)
            .fetch_optional(&state.db)
            .await 
        {
            let check_cmd = format!("sudo docker inspect -f '{{{{.State.Running}}}}' {} 2>/dev/null || echo 'false'", app.name);
            if let Ok(out) = run_ssh_command(&server, &check_cmd).await {
                let is_running = out.trim() == "true";
                let current_status = if is_running { "running" } else { "stopped" };
                
                if app.status != current_status {
                    let _ = sqlx::query("UPDATE applications SET status = ? WHERE id = ?")
                        .bind(current_status)
                        .bind(&app_id)
                        .execute(&state.db)
                        .await;
                    app.status = current_status.to_string();
                }
            }
        }
    }

    Ok(Json(app))
}

pub async fn update_application(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
    Json(input): Json<UpdateApplicationInput>,
) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query(
        "UPDATE applications SET 
            repo_url = ?, branch = ?, port = ?, env_vars = ?, build_pack_type = ?, 
            build_command = ?, run_command = ?, dockerfile_path = ?, entrypoint = ?, 
            command = ?, target = ?, work_dir = ?, privileged = ?, memory_limit = ?, cpu_limit = ?,
            cf_worker_url = ?, deploy_type = ?, registry_image = ?,
            auto_deploy_enabled = ?,
            auto_deploy_interval = ?,
            auto_deploy_timeout = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?"
    )
    .bind(&input.repo_url)
    .bind(&input.branch)
    .bind(input.port)
    .bind(&input.env_vars)
    .bind(&input.build_pack_type)
    .bind(&input.build_command)
    .bind(&input.run_command)
    .bind(&input.dockerfile_path)
    .bind(&input.entrypoint)
    .bind(&input.command)
    .bind(&input.target)
    .bind(&input.work_dir)
    .bind(input.privileged)
    .bind(&input.memory_limit)
    .bind(input.cpu_limit)
    .bind(&input.cf_worker_url)
    .bind(&input.deploy_type)
    .bind(&input.registry_image)
    .bind(input.auto_deploy_enabled.unwrap_or(0))
    .bind(input.auto_deploy_interval.unwrap_or(15))
    .bind(input.auto_deploy_timeout.unwrap_or(10))
    .bind(&app_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    add_activity_log_pro(&state.db, "Tətbiq sazlamaları yeniləndi.", "info", Some("System"), Some("admin"), Some(&app_id), None).await;

    Ok(Json(true))
}

pub async fn quick_update_autodeploy(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
    Json(input): Json<QuickAutoDeployInput>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let mut query = String::from("UPDATE applications SET updated_at = CURRENT_TIMESTAMP");
    if let Some(enabled) = input.auto_deploy_enabled {
        query.push_str(&format!(", auto_deploy_enabled = {}", enabled));
    }
    if let Some(interval) = input.auto_deploy_interval {
        query.push_str(&format!(", auto_deploy_interval = {}", interval.max(1)));
    }
    if let Some(timeout) = input.auto_deploy_timeout {
        query.push_str(&format!(", auto_deploy_timeout = {}", timeout.max(3).min(60)));
    }
    query.push_str(" WHERE id = ?");

    sqlx::query(&query)
        .bind(&app_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(true))
}

pub async fn check_application_deploy(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let app = sqlx::query_as::<_, Application>(
        "SELECT id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, \
         build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, \
         privileged, memory_limit, cpu_limit, \
         CAST(created_at AS TEXT) as created_at, CAST(updated_at AS TEXT) as updated_at, \
         last_commit_hash, cloudflare_url, cf_worker_url, deploy_type, registry_image, \
         auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout, \
         CAST(last_auto_deploy_check AS TEXT) as last_auto_deploy_check \
         FROM applications WHERE id = ?"
    )
    .bind(&app_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Application not found".to_string()))?;

    let _ = sqlx::query("UPDATE applications SET last_auto_deploy_check = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&app_id)
        .execute(&state.db)
        .await;

    let timeout_secs = app.auto_deploy_timeout.unwrap_or(10).max(3).min(60) as u64;
    let deploy_type = app.deploy_type.clone().unwrap_or_else(|| "git".to_string());

    if deploy_type == "image" {
        let reg_image = app.registry_image.clone().unwrap_or_default();
        if reg_image.trim().is_empty() {
            add_activity_log_pro(&state.db, &format!("'{}' üçün registry imic ünvanı təyin edilməyib.", app.name), "warning", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
            return Ok(Json(serde_json::json!({
                "status": "error",
                "message": "Registry imic ünvanı boşdur!"
            })));
        }

        if !reg_image.contains('/') {
            add_activity_log_pro(&state.db, &format!("'{}' üçün təyin edilmiş imic ({}) lokal servisdir, registry yoxlanışı keçildi.", app.name, reg_image), "info", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
            return Ok(Json(serde_json::json!({
                "status": "up_to_date",
                "message": format!("'{}' lokal imicdir ({}), registry yoxlanışına ehtiyac yoxdur.", app.name, reg_image)
            })));
        }

        add_activity_log_pro(&state.db, &format!("'{}' layihəsi üçün registry imici dərhal yoxlanılır (İmic: {}, Timeout: {}s)...", app.name, reg_image, timeout_secs), "info", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;

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
                                .execute(&state.db)
                                .await;
                            add_activity_log_pro(&state.db, &format!("'{}' layihəsinin ilkin imic imzası qeyd edildi: {}", app.name, remote_digest), "info", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                            Ok(Json(serde_json::json!({
                                "status": "up_to_date",
                                "message": format!("İlkin imic imzası qeyd edildi: {}", remote_digest)
                            })))
                        }
                        Some(ref local_digest) if local_digest != &remote_digest => {
                            let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                                .bind(&remote_digest)
                                .bind(&app.id)
                                .execute(&state.db)
                                .await;
                            add_activity_log_pro(&state.db, &format!("'{}' layihəsi üçün yeni registry imici tapıldı ({} -> {}). Avtomatik yenilənmə başladılır...", app.name, local_digest, remote_digest), "success", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;

                            let _ = trigger_deployment_impl(state.db.clone(), app.id.clone(), false).await;
                            Ok(Json(serde_json::json!({
                                "status": "new_version",
                                "message": format!("Yeni imic aşkarlandı ({} -> {}). Yenilənmə başladıldı!", local_digest, remote_digest)
                            })))
                        }
                        _ => {
                            add_activity_log_pro(&state.db, &format!("'{}' yoxlanıldı. Yenilik yoxdur (İmic: {}).", app.name, remote_digest), "info", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                            Ok(Json(serde_json::json!({
                                "status": "up_to_date",
                                "message": "Layihə ən son versiyadadır. Yenilik yoxdur."
                            })))
                        }
                    }
                } else {
                    add_activity_log_pro(&state.db, &format!("'{}' üçün imic manifestindən digest oxuna bilmədi.", app.name), "error", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                    Ok(Json(serde_json::json!({
                        "status": "error",
                        "message": "İmic manifestindən digest oxuna bilmədi."
                    })))
                }
            }
            Ok(Ok(out)) => {
                let err_str = String::from_utf8_lossy(&out.stderr);
                add_activity_log_pro(&state.db, &format!("'{}' üçün manifest yoxlanışı xəta verdi: {}", app.name, err_str.trim()), "error", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                Ok(Json(serde_json::json!({
                    "status": "error",
                    "message": format!("Manifest yoxlanışı xəta verdi: {}", err_str.trim())
                })))
            }
            Ok(Err(e)) => {
                add_activity_log_pro(&state.db, &format!("'{}' üçün yoxlanış əmri icra edilə bilmədi: {}", app.name, e), "error", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                Ok(Json(serde_json::json!({
                    "status": "error",
                    "message": format!("Docker əmri icra edilə bilmədi: {}", e)
                })))
            }
            Err(_) => {
                add_activity_log_pro(&state.db, &format!("'{}' üçün manifest yoxlanışı vaxt aşımına uğradı ({}s limit).", app.name, timeout_secs), "error", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                Ok(Json(serde_json::json!({
                    "status": "timeout",
                    "message": format!("Yoxlanış vaxt aşımına uğradı ({}s limit).", timeout_secs)
                })))
            }
        }
    } else {
        if app.repo_url.is_empty() || app.repo_url.starts_with("DOCKER_IMAGE:") {
            return Ok(Json(serde_json::json!({
                "status": "error",
                "message": "Git repo linki təyin edilməyib!"
            })));
        }

        add_activity_log_pro(&state.db, &format!("'{}' layihəsi üçün dərhal Git commit yoxlanılır (Budaq: {}, Timeout: {}s)...", app.name, app.branch, timeout_secs), "info", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;

        let gh_token: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'github_token'")
            .fetch_optional(&state.db)
            .await
            .unwrap_or_default();

        let token_str = gh_token.as_ref().map(|t| t.0.as_str());
        let final_repo_url = crate::utils::format_github_repo_url(&app.repo_url, token_str);

        let mut temp_ssh_key: Option<String> = None;
        if final_repo_url.starts_with("git@") || final_repo_url.starts_with("ssh://") {
            let server_row: Option<(String, Option<String>)> = sqlx::query_as("SELECT ssh_key, ssh_key_id FROM servers WHERE id = ?")
                .bind(&app.server_id)
                .fetch_optional(&state.db)
                .await
                .unwrap_or_default();

            if let Some((s_key, s_key_id)) = server_row {
                let key_content = if let Some(ref kid) = s_key_id {
                    let db_key: Option<(String,)> = sqlx::query_as("SELECT private_key FROM ssh_keys WHERE id = ?")
                        .bind(kid)
                        .fetch_optional(&state.db)
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
                if let Some(ref kpath) = temp_ssh_key {
                    let _ = std::fs::remove_file(kpath);
                }
                add_activity_log_pro(&state.db, &format!("'{}' üçün Git əmri başladıla bilmədi: {}", app.name, e), "error", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                return Ok(Json(serde_json::json!({
                    "status": "error",
                    "message": format!("Git əmri başladıla bilmədi: {}", e)
                })));
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

        let timeout_res = tokio::time::timeout(tokio::time::Duration::from_secs(timeout_secs), wait_fut).await;

        let final_res = match timeout_res {
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
                                    .execute(&state.db)
                                    .await;
                                add_activity_log_pro(&state.db, &format!("'{}' layihəsinin ilkin Git commit imzası qeyd edildi: {}", app.name, remote_sha), "info", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                                Ok(Json(serde_json::json!({
                                    "status": "up_to_date",
                                    "message": format!("İlkin commit qeyd edildi: {}", remote_sha)
                                })))
                            }
                            Some(ref local_sha) if local_sha != &remote_sha => {
                                let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                                    .bind(&remote_sha)
                                    .bind(&app.id)
                                    .execute(&state.db)
                                    .await;
                                add_activity_log_pro(&state.db, &format!("'{}' layihəsi üçün yeni commit tapıldı ({} -> {}). Avtomatik yenilənmə başladılır...", app.name, local_sha, remote_sha), "success", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;

                                let _ = trigger_deployment_impl(state.db.clone(), app.id.clone(), false).await;
                                Ok(Json(serde_json::json!({
                                    "status": "new_version",
                                    "message": format!("Yeni commit aşkarlandı ({} -> {}). Yayım başladıldı!", local_sha, remote_sha)
                                })))
                            }
                            _ => {
                                add_activity_log_pro(&state.db, &format!("'{}' yoxlanıldı. Yenilik yoxdur (Commit: {}).", app.name, remote_sha), "info", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                                Ok(Json(serde_json::json!({
                                    "status": "up_to_date",
                                    "message": "Layihə ən son commit-dədir. Yenilik yoxdur."
                                })))
                            }
                        }
                    } else {
                        add_activity_log_pro(&state.db, &format!("'{}' üçün Git çıxışından commit oxuna bilmədi.", app.name), "error", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                        Ok(Json(serde_json::json!({
                            "status": "error",
                            "message": "Git çıxışından commit oxuna bilmədi."
                        })))
                    }
                } else {
                    let err_str = String::from_utf8_lossy(&err_bytes);
                    add_activity_log_pro(&state.db, &format!("'{}' üçün git ls-remote uğursuz oldu: {}", app.name, err_str.trim()), "error", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                    Ok(Json(serde_json::json!({
                        "status": "error",
                        "message": format!("Git xətası: {}", err_str.trim())
                    })))
                }
            }
            Ok((Err(e), _, _)) => {
                add_activity_log_pro(&state.db, &format!("'{}' üçün Git yoxlanışı uğursuz oldu: {}", app.name, e), "error", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                Ok(Json(serde_json::json!({
                    "status": "error",
                    "message": format!("Git proses xətası: {}", e)
                })))
            }
            Err(_) => {
                let _ = child.kill().await;
                add_activity_log_pro(&state.db, &format!("'{}' üçün Git sorğusu vaxt aşımına uğradı ({}s limit). Proses məcburi dayandırıldı.", app.name, timeout_secs), "error", Some("Auto-Deploy"), Some("manual"), Some(&app.id), None).await;
                Ok(Json(serde_json::json!({
                    "status": "timeout",
                    "message": format!("Git sorğusu vaxt aşımına uğradı ({}s limit).", timeout_secs)
                })))
            }
        };

        if let Some(ref kpath) = temp_ssh_key {
            let _ = std::fs::remove_file(kpath);
        }

        final_res
    }
}

pub async fn check_all_applications_deploy(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let apps = match sqlx::query_as::<_, Application>(
        "SELECT id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, \
         build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, \
         privileged, memory_limit, cpu_limit, \
         CAST(created_at AS TEXT) as created_at, CAST(updated_at AS TEXT) as updated_at, \
         last_commit_hash, cloudflare_url, cf_worker_url, deploy_type, registry_image, \
         auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout, \
         CAST(last_auto_deploy_check AS TEXT) as last_auto_deploy_check \
         FROM applications \
         WHERE auto_deploy_enabled = 1 AND name NOT LIKE 'cf-tunnel-%' AND TRIM(name) != ''"
    )
    .fetch_all(&state.db)
    .await {
        Ok(a) => a,
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    let total = apps.len();
    for app in apps {
        let state_clone = state.clone();
        tokio::spawn(async move {
            let _ = check_application_deploy(State(state_clone), AxumPath(app.id)).await;
        });
    }

    Ok(Json(serde_json::json!({
        "status": "success",
        "message": format!("{} ədəd aktiv layihə üçün yoxlanış başladıldı.", total),
        "total": total
    })))
}

pub async fn delete_application(State(state): State<AppState>, AxumPath(app_id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
    let app = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
        .bind(&app_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Application not found".to_string()))?;

    let app_name_clean = app.name.trim().to_string();
    if !app_name_clean.is_empty() {
        if app.server_id == "local-server-id" || app.server_id == "local" || app.server_id.is_empty() {
            let container_name = app_name_clean.clone();
            tokio::spawn(async move {
                let _ = tokio::process::Command::new("docker")
                    .args(&["rm", "-f", &container_name])
                    .output()
                    .await;
            });
        } else if let Ok(Some(server)) = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
            .bind(&app.server_id)
            .fetch_optional(&state.db)
            .await
        {
            let cleanup_cmd = format!("sudo docker rm -f {} || true", app_name_clean);
            tokio::spawn(async move {
                let _ = run_ssh_command(&server, &cleanup_cmd).await;
            });
        }
    }

    let mut tx = state.db.begin().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _ = sqlx::query("DELETE FROM deployments WHERE application_id = ?")
        .bind(&app_id)
        .execute(&mut *tx)
        .await;

    sqlx::query("DELETE FROM applications WHERE id = ?")
        .bind(&app_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let display_name = if app.name.trim().is_empty() { "Adsız Layihə" } else { &app.name };
    add_activity_log_pro(&state.db, &format!("Tətbiq silindi: '{}'", display_name), "warning", Some("System"), Some("admin"), Some(&app_id), None).await;

    Ok(Json(true))
}

pub async fn stop_application(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let app = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
        .bind(&app_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Application not found".to_string()))?;

    let is_local = app.server_id == "local-server-id" || app.server_id == "local" || app.server_id.is_empty();
    let res = if is_local {
        let app_name = app.name.clone();
        tokio::process::Command::new("docker")
            .args(&["stop", &app_name])
            .output()
            .await
            .map(|out| out.status.success())
            .map_err(|e| e.to_string())
    } else {
        let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
            .bind(&app.server_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

        let cmd = format!("sudo docker stop {}", app.name);
        run_ssh_command(&server, &cmd).await.map(|_| true)
    };

    let _ = sqlx::query("UPDATE applications SET status = 'stopped' WHERE id = ?")
        .bind(&app_id)
        .execute(&state.db)
        .await;

    match res {
        Ok(_) => {
            add_activity_log_pro(&state.db, &format!("Tətbiq dayandırıldı: '{}'", app.name), "warning", Some("Apps"), Some("admin"), Some(&app_id), None).await;
            Ok(Json(true))
        },
        Err(err) => {
            add_activity_log_pro(&state.db, &format!("Tətbiq dayandırılarkən xəta: '{}' ({})", app.name, err), "error", Some("Apps"), Some("admin"), Some(&app_id), None).await;
            Err((StatusCode::BAD_REQUEST, format!("Dayandırma xətası: {}", err)))
        },
    }
}

pub async fn restart_application(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let app = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
        .bind(&app_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Application not found".to_string()))?;

    let is_local = app.server_id == "local-server-id" || app.server_id == "local" || app.server_id.is_empty();
    let res = if is_local {
        let app_name = app.name.clone();
        tokio::process::Command::new("docker")
            .args(&["restart", &app_name])
            .output()
            .await
            .map(|out| out.status.success())
            .map_err(|e| e.to_string())
    } else {
        let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
            .bind(&app.server_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

        let cmd = format!("sudo docker restart {}", app.name);
        run_ssh_command(&server, &cmd).await.map(|_| true)
    };

    let new_status = if res.is_ok() { "running" } else { "stopped" };
    let _ = sqlx::query("UPDATE applications SET status = ? WHERE id = ?")
        .bind(new_status)
        .bind(&app_id)
        .execute(&state.db)
        .await;

    match res {
        Ok(_) => {
            add_activity_log_pro(&state.db, &format!("Tətbiq yenidən başladıldı: '{}'", app.name), "success", Some("Apps"), Some("admin"), Some(&app_id), None).await;
            Ok(Json(true))
        },
        Err(err) => {
            add_activity_log_pro(&state.db, &format!("Tətbiq restart xətası: '{}' ({})", app.name, err), "error", Some("Apps"), Some("admin"), Some(&app_id), None).await;
            Err((StatusCode::BAD_REQUEST, format!("Restart xətası: {}", err)))
        },
    }
}

pub async fn get_runtime_logs(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<String>, (StatusCode, String)> {
    let app = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
        .bind(&app_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Application not found".to_string()))?;

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&app.server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = std::env::temp_dir().join(format!("temp_logs_key_{}.key", uuid::Uuid::new_v4())).to_string_lossy().into_owned();
    
    let key_content = if let Some(ref kid) = server.ssh_key_id {
        let db_key: Option<(String,)> = sqlx::query_as("SELECT private_key FROM ssh_keys WHERE id = ?")
            .bind(kid)
            .fetch_optional(&state.db)
            .await
            .unwrap_or_default();
        db_key.map(|r| r.0).unwrap_or_else(|| server.ssh_key.clone())
    } else {
        server.ssh_key.clone()
    };

    let key_content = if key_content.contains("BEGIN ") {
        key_content
    } else {
        std::fs::read_to_string(key_content.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    let normalized_key = key_content.replace("\r\n", "\n").replace('\r', "\n").trim().to_string() + "\n";
    if let Err(e) = std::fs::write(&temp_key_path, &normalized_key) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write key: {}", e)));
    }

    #[cfg(target_os = "windows")]
    {
        let identity = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/inheritance:r"]).output();
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("chmod").args(&["600", &temp_key_path]).output();
    }

    let cmd = format!("sudo docker logs --tail 200 {}", app.name);
    let output = match {
        if server.ip == "local" || server.ip == "127.0.0.1" {
            let local_cmd = cmd.replace("sudo ", "");
            tokio::process::Command::new("sh")
                .arg("-c")
                .arg(&local_cmd)
                .output()
                .await
        } else {
            tokio::process::Command::new("ssh")
                .args(&[
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "ConnectTimeout=5",
                    "-o", "ServerAliveInterval=3",
                    "-o", "ServerAliveCountMax=2",
                    "-i", &temp_key_path,
                    &format!("{}@{}", server.ssh_user, server.ip),
                    &cmd
                ])
                .output()
                .await
        }
    } {
        Ok(o) => {
            let mut logs = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            if !stderr.is_empty() {
                if !logs.is_empty() { logs.push('\n'); }
                logs.push_str(&stderr);
            }
            logs
        }
        Err(e) => format!("SSH Error: {}", e),
    };

    let _ = std::fs::remove_file(&temp_key_path);
    Ok(Json(output))
}

pub async fn run_ssh_command(server: &Server, cmd: &str) -> Result<String, String> {
    let db_path = if std::path::Path::new("/.dockerenv").exists() || (cfg!(target_family = "unix") && std::path::Path::new("/app/data").exists()) {
        "/app/data/masterdeploy.db".to_string()
    } else {
        "masterdeploy.db".to_string()
    };
    if let Ok(pool) = SqlitePool::connect(&format!("sqlite:{}", db_path)).await {
        run_ssh_command_impl(&pool, server, cmd).await
    } else {
        Err("Failed to open database for SSH key retrieval".to_string())
    }
}

pub async fn run_ssh_command_impl(db: &SqlitePool, server: &Server, cmd: &str) -> Result<String, String> {
    let temp_key_path = std::env::temp_dir().join(format!("temp_cmd_key_{}.key", uuid::Uuid::new_v4())).to_string_lossy().into_owned();
    
    let key_content = if let Some(ref kid) = server.ssh_key_id {
        let db_key: Option<(String,)> = sqlx::query_as("SELECT private_key FROM ssh_keys WHERE id = ?")
            .bind(kid)
            .fetch_optional(db)
            .await
            .unwrap_or_default();
        db_key.map(|r| r.0).unwrap_or_else(|| server.ssh_key.clone())
    } else {
        server.ssh_key.clone()
    };

    let key_content = if key_content.contains("BEGIN ") {
        key_content
    } else {
        std::fs::read_to_string(key_content.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    let normalized_key = key_content.replace("\r\n", "\n").replace('\r', "\n").trim().to_string() + "\n";
    if let Err(e) = std::fs::write(&temp_key_path, &normalized_key) {
        return Err(format!("Failed to write key: {}", e));
    }

    #[cfg(target_os = "windows")]
    {
        let identity = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/inheritance:r"]).output();
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("chmod").args(&["600", &temp_key_path]).output();
    }

    let output = if server.ip == "local" || server.ip == "127.0.0.1" {
        let local_cmd = cmd.replace("sudo ", "");
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&local_cmd)
            .output()
            .await
    } else {
        let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };
        tokio::process::Command::new(ssh_bin)
            .args(&[
                "-o", "StrictHostKeyChecking=no",
                "-o", "ConnectTimeout=10",
                "-o", "ServerAliveInterval=3",
                "-o", "ServerAliveCountMax=2",
                "-i", &temp_key_path,
                &format!("{}@{}", server.ssh_user, server.ip),
                cmd
            ])
            .output()
            .await
    };

    let _ = std::fs::remove_file(&temp_key_path);

    match output {
        Ok(out) if out.status.success() => Ok(String::from_utf8_lossy(&out.stdout).to_string()),
        Ok(out) => Err(format!("Command failed: {}", String::from_utf8_lossy(&out.stderr))),
        Err(e) => Err(format!("Failed to execute command: {}", e)),
    }
}
