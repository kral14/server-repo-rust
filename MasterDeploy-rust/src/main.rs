use axum::{
    extract::{Path as AxumPath, State, Query},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use sqlx::SqlitePool;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use uuid::Uuid;

mod db;
mod models;
mod plugins;

use models::{Application, CreateApplicationInput, CreateServerInput, UpdateServerInput, Deployment, Server, ActivityLog, CreateActivityLogInput};

async fn perform_docker_login(token: &str) {
    if token.is_empty() {
        return;
    }
    let output = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(format!("echo '{}' | docker login ghcr.io -u kral14 --password-stdin", token))
        .output()
        .await;
        
    match output {
        Ok(out) if out.status.success() => {
            println!("[INFO] Docker GHCR login succeeded automatically inside container.");
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr);
            eprintln!("[ERROR] Docker GHCR login failed inside container: {}", err.trim());
        }
        Err(e) => {
            eprintln!("[ERROR] Failed to run docker login inside container: {}", e);
        }
    }
}

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
}

#[tokio::main]
async fn main() {
    let pool = db::init_db().await.expect("Failed to initialize database");
    let state = AppState { db: pool.clone() };

    // Verilənlər bazasının avtomatik ehtiyat nüsxəsini (backup) çıxarırıq
    let _ = std::fs::copy("MasterDeploy-rust/masterdeploy.db", "MasterDeploy-rust/masterdeploy.db.backup");

    // Start-up zamanı köhnə MasterDeploy yenilənmə köməkçi konteynerlərini tamamilə silirik
    let _ = std::process::Command::new("docker").args(["rm", "-f", "masterdeploy-updater"]).status();

    // Start-up zamanı yarımçıq qalmış (ilişmiş) deployment statuslarını 'failed' edirik
    let _ = sqlx::query("UPDATE deployments SET status = 'failed' WHERE status = 'building' OR status = 'deploying'")
        .execute(&pool)
        .await;

    // Eyni zamanda tətbiqlərin (applications) də statusu 'deploying' qalıbsa, onu 'stopped' edirik
    let _ = sqlx::query("UPDATE applications SET status = 'stopped' WHERE status = 'deploying'")
        .execute(&pool)
        .await;

    // Start-up zamanı GitHub tokeni mövcuddursa, konteyner daxilində GHCR login edirik
    if let Ok(Some((github_token,))) = sqlx::query_as::<_, (String,)>("SELECT value FROM settings WHERE key = 'github_token'")
        .fetch_optional(&pool)
        .await 
    {
        perform_docker_login(&github_token).await;
    }

    // Git repositoriyalarını yeniliklər üçün yoxlayan arxa plan loopunu başladırıq
    tokio::spawn(git_polling_loop(pool.clone()));

    let app = Router::new()
        .nest_service("/", ServeDir::new("static"))
        .route("/api/servers", get(list_servers).post(create_server))
        .route("/api/servers/:server_id", get(get_server).put(update_server).delete(delete_server))
        .route("/api/servers/:server_id/stats", get(get_server_stats))
        .route("/api/servers/:server_id/setup", post(setup_server))
        .route("/api/servers/:server_id/check", get(check_server_connection))
        .route("/api/servers/:server_id/volumes", get(list_server_volumes))
        .route("/api/servers/:server_id/volumes/:volume_name", post(delete_server_volume))
        .route("/api/applications", get(list_applications).post(create_application))
        .route("/api/applications/:app_id", get(get_application).put(update_application).delete(delete_application))
        .route("/api/applications/:app_id/stop", post(stop_application))
        .route("/api/applications/:app_id/restart", post(restart_application))
        .route("/api/deploy/:app_id", post(trigger_deployment))
        .nest("/api/plugins/cloudflare", Router::new()
            .route("/start/:app_id", post(plugins::cloudflare::start_cloudflare_tunnel))
            .route("/logs/:app_id", get(plugins::cloudflare::get_cloudflare_tunnel_logs))
            .route("/stop/:app_id", post(plugins::cloudflare::stop_cloudflare_tunnel))
            .route("/settings", get(plugins::cloudflare::get_cloudflare_settings).post(plugins::cloudflare::save_cloudflare_settings))
            .route("/check", get(plugins::cloudflare::check_cloudflare_connection))
            .route("/deploy-worker/:app_id", post(plugins::cloudflare::deploy_worker))
            .route("/delete-worker/:app_id", post(plugins::cloudflare::delete_worker))
        )
        .merge(plugins::router())

        .route("/api/deploy/cancel/:deploy_id", post(cancel_deployment))
        .route("/api/deployments/:app_id", get(list_deployments))
        .route("/api/deployments/single/:deploy_id", get(get_deployment))
        .route("/api/runtime-logs/:app_id", get(get_runtime_logs))
        .route("/api/version", get(get_version))
        .route("/api/system/changelog", get(get_changelog))
        .route("/api/system/docs", get(get_docs))
        .route("/api/system/update", post(trigger_system_update))
        .route("/api/settings/github-token", get(get_github_token).post(save_github_token))
        .route("/api/activity-logs", get(list_activity_logs).post(create_activity_log).delete(clear_activity_logs))
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("no-store, no-cache, must-revalidate, max-age=0"),
        ))
        .layer(CorsLayer::permissive())
        .layer(axum::middleware::from_fn(request_logger))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    println!("🛸 DeployMaster server running at http://{}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn get_version() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "name": "DeployMaster"
    }))
}

async fn list_servers(State(state): State<AppState>) -> Result<Json<Vec<Server>>, (StatusCode, String)> {
    let servers = sqlx::query_as::<_, Server>("SELECT * FROM servers ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(servers))
}

async fn create_server(State(state): State<AppState>, Json(input): Json<CreateServerInput>) -> Result<(StatusCode, Json<Server>), (StatusCode, String)> {
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM servers WHERE ip = ?")
        .bind(&input.ip)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        
    if exists.is_some() {
        return Err((StatusCode::BAD_REQUEST, "Bu IP ünvanına malik server artıq mövcuddur!".to_string()));
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, ?, ?, ?, ?)")
        .bind(&id).bind(&input.name).bind(&input.ip).bind(&input.ssh_user).bind(&input.ssh_key)
        .execute(&state.db).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let server = Server {
        id,
        name: input.name,
        ip: input.ip,
        ssh_user: input.ssh_user,
        ssh_key: input.ssh_key,
        created_at: String::new(),
        updated_at: String::new(),
    };
    Ok((StatusCode::CREATED, Json(server)))
}

async fn get_server(State(state): State<AppState>, AxumPath(server_id): AxumPath<String>) -> Result<Json<Server>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;
    Ok(Json(server))
}

async fn update_server(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
    Json(input): Json<UpdateServerInput>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM servers WHERE ip = ? AND id != ?")
        .bind(&input.ip)
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        
    if exists.is_some() {
        return Err((StatusCode::BAD_REQUEST, "Bu IP ünvanına malik server artıq mövcuddur!".to_string()));
    }

    sqlx::query("UPDATE servers SET name = ?, ip = ?, ssh_user = ?, ssh_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&input.name)
        .bind(&input.ip)
        .bind(&input.ssh_user)
        .bind(&input.ssh_key)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

async fn delete_server(State(state): State<AppState>, AxumPath(server_id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
    // Start a transaction to ensure atomic deletes
    let mut tx = state.db.begin().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 1. Delete all deployments for applications running on this server
    sqlx::query("DELETE FROM deployments WHERE application_id IN (SELECT id FROM applications WHERE server_id = ?)")
        .bind(&server_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 2. Delete all applications running on this server
    sqlx::query("DELETE FROM applications WHERE server_id = ?")
        .bind(&server_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 3. Delete the server itself
    sqlx::query("DELETE FROM servers WHERE id = ?")
        .bind(&server_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

async fn get_server_stats(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = format!("temp_stats_key_{}.key", uuid::Uuid::new_v4());
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    if let Err(e) = std::fs::write(&temp_key_path, &key_content) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write key: {}", e)));
    }

    #[cfg(target_os = "windows")]
    {
        let domain = std::env::var("USERDOMAIN").unwrap_or_default();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let identity = if domain.is_empty() { user } else { format!("{}\\{}", domain, user) };
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/inheritance:r"]).output();
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("chmod").args(&["600", &temp_key_path]).output();
    }

    let cmd = "free -m | awk 'NR==2{print $2,$3}'; nproc; echo '---'; sudo docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' 2>/dev/null || true";
    
    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };
    
    // 3 saniyəlik qəti gözləmə limiti (timeout) tətbiq edirik
    let run_future = async {
        if server.ip == "local" || server.ip == "127.0.0.1" {
            let local_cmd = cmd.replace("sudo ", "");
            tokio::process::Command::new("sh")
                .arg("-c")
                .arg(&local_cmd)
                .output()
                .await
        } else {
            tokio::process::Command::new(ssh_bin)
                .args(&[
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "BatchMode=yes",
                    "-o", "ConnectTimeout=1",
                    "-o", "ServerAliveInterval=1",
                    "-o", "ServerAliveCountMax=1",
                    "-i", &temp_key_path,
                    &format!("{}@{}", server.ssh_user, server.ip),
                    cmd
                ])
                .output()
                .await
        }
    };

    let output_res = tokio::time::timeout(std::time::Duration::from_millis(1500), run_future).await;
    let _ = std::fs::remove_file(&temp_key_path);

    let output = match output_res {
        Ok(Ok(out)) => out,
        _ => {
            // Həm timeout, həm də daxili icra xətası halında boş məlumat qaytarırıq
            return Ok(Json(serde_json::json!({"total_ram_mb": 0, "used_ram_mb": 0, "cores": 0, "containers": {}})));
        }
    };

    if !output.status.success() {
        return Ok(Json(serde_json::json!({"total_ram_mb": 0, "used_ram_mb": 0, "cores": 0, "containers": {}})));
    }

    let result_str = String::from_utf8_lossy(&output.stdout);
    let sections: Vec<&str> = result_str.split("---").collect();

    let mut total_ram_mb = 0;
    let mut used_ram_mb = 0;
    let mut cores = 1;
    let mut containers = serde_json::json!({});

    if let Some(sys_section) = sections.get(0) {
        let parts: Vec<&str> = sys_section.trim().split_whitespace().collect();
        if parts.len() >= 3 {
            total_ram_mb = parts[0].parse::<u64>().unwrap_or(0);
            used_ram_mb = parts[1].parse::<u64>().unwrap_or(0);
            cores = parts[2].parse::<u64>().unwrap_or(1);
        }
    }

    if let Some(docker_section) = sections.get(1) {
        let mut container_map = serde_json::Map::new();
        for line in docker_section.trim().lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                let name = parts[0].to_string();
                let cpu = parts[1].to_string();
                let mem = parts[2].to_string();
                container_map.insert(name, serde_json::json!({
                    "cpu": cpu,
                    "memory": mem
                }));
            }
        }
        containers = serde_json::Value::Object(container_map);
    }

    let stats = serde_json::json!({
        "total_ram_mb": total_ram_mb,
        "used_ram_mb": used_ram_mb,
        "cores": cores,
        "containers": containers
    });
    Ok(Json(stats))
}

async fn sync_remote_applications(db: &sqlx::SqlitePool, server: &Server, temp_key_path: &str) -> Result<usize, String> {
    println!("[SYNC] '{}' (IP: {}) serverində layihə axtarışı başladıldı...", server.name, server.ip);
    
    let cmd = "CONTAINER_NAME=$(sudo docker ps --format \"{{.Names}} {{.Image}}\" | grep \"server-repo-rust\" | awk '{print $1}' | head -n 1); \
               if [ -z \"$CONTAINER_NAME\" ]; then CONTAINER_NAME=$(sudo docker ps --format \"{{.Names}}\" | grep \"masterdeploy\" | head -n 1); fi; \
               if [ -n \"$CONTAINER_NAME\" ]; then \
                   sudo docker exec $CONTAINER_NAME sqlite3 -json /app/data/masterdeploy.db \"SELECT id, name, repo_url, branch, port, env_vars, build_pack_type, build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, privileged, memory_limit, cpu_limit, cloudflare_url, cf_worker_url, deploy_type, registry_image FROM applications\" 2>/dev/null; \
               else \
                   if [ -f \"/data/masterdeploy/masterdeploy.db\" ]; then \
                       sqlite3 -json /data/masterdeploy/masterdeploy.db \"SELECT id, name, repo_url, branch, port, env_vars, build_pack_type, build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, privileged, memory_limit, cpu_limit, cloudflare_url, cf_worker_url, deploy_type, registry_image FROM applications\" 2>/dev/null; \
                   elif [ -f \"masterdeploy.db\" ]; then \
                       sqlite3 -json masterdeploy.db \"SELECT id, name, repo_url, branch, port, env_vars, build_pack_type, build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, privileged, memory_limit, cpu_limit, cloudflare_url, cf_worker_url, deploy_type, registry_image FROM applications\" 2>/dev/null; \
                   fi; \
               fi";
    
    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };
    
    let output = if server.ip == "local" || server.ip == "127.0.0.1" {
        println!("[SYNC] Local Host üçün uzaqdan skan tələb olunmur.");
        return Ok(0);
    } else {
        println!("[SYNC] SSH vasitəsilə uzaq serverə sorğu göndərilir...");
        tokio::process::Command::new(ssh_bin)
            .args(&[
                "-o", "StrictHostKeyChecking=no",
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=15",
                "-i", temp_key_path,
                &format!("{}@{}", server.ssh_user, server.ip),
                cmd
            ])
            .output()
            .await
            .map_err(|e| {
                let err_msg = format!("[SYNC ERROR] SSH prosesini başlatmaq mümkün olmadı: {}", e);
                eprintln!("{}", err_msg);
                err_msg
            })?
    };

    let mut apps: Vec<serde_json::Value> = Vec::new();
    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    println!("[SYNC DEBUG] Uzaq serverdən gələn stdout: '{}'", stdout_str);

    if output.status.success() && !stdout_str.is_empty() && stdout_str.starts_with('[') {
        if let Ok(v) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout_str) {
            apps = v;
        }
    }

    // Əgər uzaq serverdə masterdeploy tapılmadısa və ya boşdursa, mərkəzi server (84.8.148.216) üzərindən cəhd edirik
    if apps.is_empty() {
        println!("[SYNC] Uzaq serverin özündə MasterDeploy verilənlər bazası tapılmadı. Mərkəzi veritabanı (84.8.148.216) yoxlanılır...");
        
        let central_row: Option<(String, String, String, String)> = sqlx::query_as(
            "SELECT name, ip, ssh_user, ssh_key FROM servers WHERE ip = '84.8.148.216' OR (ip != 'local' AND ip != ?) LIMIT 1"
        )
        .bind(&server.ip)
        .fetch_optional(db)
        .await
        .unwrap_or(None);

        if let Some((c_name, c_ip, c_ssh_user, c_ssh_key)) = central_row {
            println!("[SYNC] Mərkəzi MasterDeploy serveri aşkar edildi: '{}' (IP: {}). Sorğu göndərilir...", c_name, c_ip);
            let c_temp_key_path = format!("temp_central_key_{}.key", uuid::Uuid::new_v4());
            let c_key_content = if c_ssh_key.contains("BEGIN ") {
                c_ssh_key.clone()
            } else {
                std::fs::read_to_string(c_ssh_key.trim()).unwrap_or_else(|_| c_ssh_key.clone())
            };

            if std::fs::write(&c_temp_key_path, &c_key_content).is_ok() {
                #[cfg(target_os = "windows")]
                {
                    let domain = std::env::var("USERDOMAIN").unwrap_or_default();
                    let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
                    let identity = if domain.is_empty() { user } else { format!("{}\\{}", domain, user) };
                    let _ = std::process::Command::new("icacls").args(&[&c_temp_key_path, "/inheritance:r"]).output();
                    let _ = std::process::Command::new("icacls").args(&[&c_temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
                }

                // Mərkəzi serverdən yoxlanılan serverin IP-sinə görə layihələri sorğulayırıq
                let central_cmd = format!(
                    "CONTAINER_NAME=$(sudo docker ps --format \"{{.Names}} {{.Image}}\" | grep \"server-repo-rust\" | awk '{{print $1}}' | head -n 1); \
                     if [ -z \"$CONTAINER_NAME\" ]; then CONTAINER_NAME=$(sudo docker ps --format \"{{.Names}}\" | grep \"masterdeploy\" | head -n 1); fi; \
                     if [ -n \"$CONTAINER_NAME\" ]; then \
                         sudo docker exec $CONTAINER_NAME sqlite3 -json /app/data/masterdeploy.db \"SELECT a.id, a.name, a.repo_url, a.branch, a.port, a.env_vars, a.build_pack_type, a.build_command, a.run_command, a.dockerfile_path, a.entrypoint, a.command, a.target, a.work_dir, a.privileged, a.memory_limit, a.cpu_limit, a.cloudflare_url, a.cf_worker_url, a.deploy_type, a.registry_image, s.ip AS server_ip FROM applications a LEFT JOIN servers s ON a.server_id = s.id WHERE s.ip = '{}' OR s.ip = 'local'\" 2>/dev/null; \
                     fi",
                    server.ip
                );

                let c_output = tokio::process::Command::new(ssh_bin)
                    .args(&[
                        "-o", "StrictHostKeyChecking=no",
                        "-o", "BatchMode=yes",
                        "-o", "ConnectTimeout=15",
                        "-i", &c_temp_key_path,
                        &format!("{}@{}", c_ssh_user, c_ip),
                        &central_cmd
                    ])
                    .output()
                    .await;

                let _ = std::fs::remove_file(&c_temp_key_path);

                if let Ok(out) = c_output {
                    if out.status.success() {
                        let c_stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        if !c_stdout.is_empty() && c_stdout.starts_with('[') {
                            if let Ok(v) = serde_json::from_str::<Vec<serde_json::Value>>(&c_stdout) {
                                println!("[SYNC] Mərkəzi serverdən bu serverə ({}) aid {} layihə uğurla çəkildi!", server.ip, v.len());
                                apps = v;
                            }
                        }
                    }
                }
            }
        }
    }

    let mut imported_count = 0;
    println!("[SYNC] Cəmi {} layihə emal edilir. Lokal verilənlər bazası ilə müqayisə edilir...", apps.len());
    for app in apps {
        let id = match app["id"].as_str() {
            Some(v) => v.to_string(),
            None => continue,
        };
        let name = app["name"].as_str().unwrap_or("Unnamed App").to_string();
        let repo_url = app["repo_url"].as_str().unwrap_or("").to_string();
        let branch = app["branch"].as_str().unwrap_or("main").to_string();
        let port = app["port"].as_i64().unwrap_or(80) as i32;
        let env_vars = app["env_vars"].as_str().map(|s| s.to_string());
        let build_pack_type = app["build_pack_type"].as_str().unwrap_or("dockerfile").to_string();
        let build_command = app["build_command"].as_str().map(|s| s.to_string());
        let run_command = app["run_command"].as_str().map(|s| s.to_string());
        let dockerfile_path = app["dockerfile_path"].as_str().map(|s| s.to_string());
        let entrypoint = app["entrypoint"].as_str().map(|s| s.to_string());
        let command = app["command"].as_str().map(|s| s.to_string());
        let target = app["target"].as_str().map(|s| s.to_string());
        let work_dir = app["work_dir"].as_str().map(|s| s.to_string());
        let privileged = app["privileged"].as_i64().unwrap_or(0) as i32;
        let memory_limit = app["memory_limit"].as_str().map(|s| s.to_string());
        let cpu_limit = app["cpu_limit"].as_f64();
        let cloudflare_url = app["cloudflare_url"].as_str().map(|s| s.to_string());
        let cf_worker_url = app["cf_worker_url"].as_str().map(|s| s.to_string());
        let deploy_type = app["deploy_type"].as_str().unwrap_or("git").to_string();
        let registry_image = app["registry_image"].as_str().map(|s| s.to_string());
        let server_ip = app["server_ip"].as_str().unwrap_or(&server.ip).to_string();
        let target_server_id = if server_ip == "local" {
            "local-server-id".to_string()
        } else {
            let row_res: Option<(String,)> = sqlx::query_as("SELECT id FROM servers WHERE ip = ?")
                .bind(&server_ip)
                .fetch_optional(db)
                .await
                .unwrap_or(None);
            row_res.map(|r| r.0).unwrap_or_else(|| server.id.clone())
        };

        let mut exists: Option<(String,)> = sqlx::query_as("SELECT id FROM applications WHERE id = ?")
            .bind(&id)
            .fetch_optional(db)
            .await
            .unwrap_or(None);

        if exists.is_none() {
            let by_name: Option<(String,)> = sqlx::query_as("SELECT id FROM applications WHERE name = ?")
                .bind(&name)
                .fetch_optional(db)
                .await
                .unwrap_or(None);
            if let Some((old_id,)) = by_name {
                println!("[SYNC] '{}' layihəsinin ID-si fərqlidir (Lokal: {}, Mərkəzi: {}). Köhnə qeyd silinir...", name, old_id, &id);
                let _ = sqlx::query("DELETE FROM applications WHERE id = ?").bind(&old_id).execute(db).await;
                exists = None;
            }
        }

        if exists.is_none() {
            println!("[SYNC] Yeni layihə tapıldı. Lokal bazaya yazılır: '{}' (ID: {}, Server IP: {})", name, id, server_ip);
            let _ = sqlx::query(
                "INSERT INTO applications (id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, privileged, memory_limit, cpu_limit, cloudflare_url, cf_worker_url, deploy_type, registry_image) \
                 VALUES (?, ?, ?, ?, ?, ?, 'stopped', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&id)
            .bind(&name)
            .bind(&repo_url)
            .bind(&branch)
            .bind(port)
            .bind(&target_server_id)
            .bind(env_vars)
            .bind(build_pack_type)
            .bind(build_command)
            .bind(run_command)
            .bind(dockerfile_path)
            .bind(entrypoint)
            .bind(command)
            .bind(target)
            .bind(work_dir)
            .bind(privileged)
            .bind(memory_limit)
            .bind(cpu_limit)
            .bind(cloudflare_url)
            .bind(cf_worker_url)
            .bind(deploy_type)
            .bind(registry_image)
            .execute(db)
            .await;
            
            imported_count += 1;
        } else {
            println!("[SYNC] '{}' layihəsi artıq lokal bazada mövcuddur. Mərkəzi bazadakı server və cloudflare/worker linkləri yenilənir...", name);
            let _ = sqlx::query(
                "UPDATE applications SET server_id = ?, cloudflare_url = ?, cf_worker_url = ?, repo_url = ?, branch = ?, port = ?, env_vars = ?, deploy_type = ?, registry_image = ? WHERE id = ? OR name = ?"
            )
            .bind(&target_server_id)
            .bind(&cloudflare_url)
            .bind(&cf_worker_url)
            .bind(&repo_url)
            .bind(&branch)
            .bind(port)
            .bind(&env_vars)
            .bind(&deploy_type)
            .bind(&registry_image)
            .bind(&id)
            .bind(&name)
            .execute(db)
            .await;
        }
    }
    
    // Həmçinin uzaq serverdəki aktiv docker konteynerlərini skan edirik (Auto-Discover)
    println!("[SYNC] Uzaq serverdəki digər işlək Docker konteynerləri skan edilir...");
    let docker_ps_cmd = "sudo docker ps --format \"{{.Names}}|{{.Image}}|{{.Ports}}|{{.State}}\"";
    let ps_output = if server.ip == "local" || server.ip == "127.0.0.1" {
        return Ok(imported_count);
    } else {
        tokio::process::Command::new(ssh_bin)
            .args(&[
                "-o", "StrictHostKeyChecking=no",
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=15",
                "-i", temp_key_path,
                &format!("{}@{}", server.ssh_user, server.ip),
                docker_ps_cmd
            ])
            .output()
            .await
            .unwrap_or_else(|_| output.clone())
    };

    if ps_output.status.success() {
        let ps_str = String::from_utf8_lossy(&ps_output.stdout).trim().to_string();
        for line in ps_str.lines() {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() >= 4 {
                let name = parts[0].trim();
                let image = parts[1].trim();
                let ports_str = parts[2].trim();
                let state_str = parts[3].trim();

                if name == "masterdeploy" || name == "portainer" || name == "masterdeploy-updater" || name.is_empty() {
                    continue;
                }

                let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM applications WHERE name = ?")
                    .bind(name)
                    .fetch_optional(db)
                    .await
                    .unwrap_or(None);

                if exists.is_none() {
                    println!("[SYNC] Yeni Docker konteyneri aşkar edildi! Lokal bazaya layihə kimi idxal olunur: '{}'", name);
                    let new_id = uuid::Uuid::new_v4().to_string();
                    let port_num = if ports_str.is_empty() {
                        80
                    } else {
                        let mut p_val = 80;
                        if let Some(colon_idx) = ports_str.rfind(':') {
                            let rest = &ports_str[colon_idx+1..];
                            if let Some(arrow_idx) = rest.find("->") {
                                if let Ok(p) = rest[..arrow_idx].trim().parse::<i32>() {
                                    p_val = p;
                                }
                            }
                        }
                        p_val
                    };

                    let _ = sqlx::query(
                        "INSERT INTO applications (id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, privileged, memory_limit, cpu_limit, cloudflare_url, cf_worker_url, deploy_type, registry_image) \
                         VALUES (?, ?, ?, 'main', ?, ?, ?, NULL, 'dockerfile', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, 'image', ?)"
                    )
                    .bind(&new_id)
                    .bind(name)
                    .bind(image)
                    .bind(port_num)
                    .bind(&server.id)
                    .bind(if state_str.contains("running") { "running" } else { "stopped" })
                    .bind(image)
                    .execute(db)
                    .await;

                    imported_count += 1;
                } else {
                    println!("[SYNC] '{}' konteyneri artıq lokal bazada mövcuddur. İdxal edilmədi.", name);
                }
            }
        }
    }
    
    println!("[SYNC] Sinxronizasiya tamamlandı! Cəmi {} yeni layihə lokal bazaya əlavə edildi.", imported_count);
    Ok(imported_count)
}

async fn check_server_connection(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = format!("temp_check_key_{}.key", uuid::Uuid::new_v4());
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    if let Err(e) = std::fs::write(&temp_key_path, &key_content) {
        return Ok(Json(serde_json::json!({
            "success": false,
            "error": format!("Key write error: {}", e)
        })));
    }

    #[cfg(target_os = "windows")]
    {
        let domain = std::env::var("USERDOMAIN").unwrap_or_default();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let identity = if domain.is_empty() { user } else { format!("{}\\{}", domain, user) };
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/inheritance:r"]).output();
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("chmod").args(&["600", &temp_key_path]).output();
    }

    let cmd = "echo 'OK'";
    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };

    let run_future = async {
        if server.ip == "local" || server.ip == "127.0.0.1" {
            tokio::process::Command::new("sh")
                .arg("-c")
                .arg(cmd)
                .output()
                .await
        } else {
            tokio::process::Command::new(ssh_bin)
                .args(&[
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "BatchMode=yes",
                    "-o", "ConnectTimeout=4",
                    "-o", "ServerAliveInterval=2",
                    "-o", "ServerAliveCountMax=1",
                    "-i", &temp_key_path,
                    &format!("{}@{}", server.ssh_user, server.ip),
                    cmd
                ])
                .output()
                .await
        }
    };

    let output_res = tokio::time::timeout(std::time::Duration::from_secs(5), run_future).await;
 
    let output = match output_res {
        Ok(Ok(out)) => Ok(out),
        Ok(Err(e)) => Err(format!("SSH prosesi başladılarkən sistem xətası yarandı: {}", e)),
        Err(_) => Err("Qoşulma limiti aşdı (Timeout 5s). Serverə qoşulmaq mümkün olmadı.".to_string())
    };

    let result = match output {
        Ok(out) if out.status.success() => {
            let mut sync_message = String::new();
            if let Ok(count) = sync_remote_applications(&state.db, &server, &temp_key_path).await {
                if count > 0 {
                    sync_message = format!(" Həmçinin uzaq serverdən {} yeni layihə sinxronlaşdırıldı!", count);
                }
            }

            Ok(Json(serde_json::json!({
                "success": true,
                "message": format!("Connection successful!{}", sync_message)
            })))
        }
        Ok(out) => {
            let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
            let out_msg = String::from_utf8_lossy(&out.stdout).to_string();
            let full_err = format!("{}\n{}", out_msg, err_msg).trim().to_string();
            Ok(Json(serde_json::json!({
                "success": false,
                "error": if full_err.is_empty() { "SSH connection failed without stdout/stderr".to_string() } else { full_err }
            })))
        }
        Err(e) => {
            Ok(Json(serde_json::json!({
                "success": false,
                "error": format!("Failed to spawn SSH process: {}", e)
            })))
        }
    };

    let _ = std::fs::remove_file(&temp_key_path);
    result
}

async fn list_server_volumes(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = format!("temp_vols_key_{}.key", uuid::Uuid::new_v4());
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    if let Err(e) = std::fs::write(&temp_key_path, &key_content) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write key: {}", e)));
    }

    #[cfg(target_os = "windows")]
    {
        let domain = std::env::var("USERDOMAIN").unwrap_or_default();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let identity = if domain.is_empty() { user } else { format!("{}\\{}", domain, user) };
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/inheritance:r"]).output();
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("chmod").args(&["600", &temp_key_path]).output();
    }

    let cmd = "sudo docker volume ls --format '{{.Name}} {{.Driver}}' && echo '---' && \
               sudo docker ps -a --format '{{.Names}}' | xargs -I {} sh -c 'echo -n \"{} \"; sudo docker inspect --format \"{{range .Mounts}}{{.Name}} {{end}}\" {}' && echo '---' && \
               sudo docker system df -v | awk '/VOLUME NAME/{flag=1;next}/^$/{flag=0}flag{print $1,$3}' && echo '---' && \
               df -h / | awk 'NR==2 {print $2,$4,$5}' && echo '---' && \
               sudo docker ps -a --size --format '{{.Names}}:::{{.Size}}'";

    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };
    
    let run_future = async {
        if server.ip == "local" || server.ip == "127.0.0.1" {
            if cfg!(target_os = "windows") {
                let win_cmd = "docker volume ls --format '{{.Name}} {{.Driver}}'; echo '---'; docker ps -a --format '{{.Names}}' | foreach { $name = $_; $mounts = (docker inspect --format '{{range .Mounts}}{{.Name}} {{end}}' $name); echo \"$name mounted: $mounts\" }; echo '---'; docker volume ls --format '{{.Name}}' | foreach { echo \"$_ 0B\" }";
                tokio::process::Command::new("powershell")
                    .args(&["-Command", win_cmd])
                    .output()
                    .await
            } else {
                let local_cmd = cmd.replace("sudo ", "");
                tokio::process::Command::new("sh")
                    .arg("-c")
                    .arg(&local_cmd)
                    .output()
                    .await
            }
        } else {
            tokio::process::Command::new(ssh_bin)
                .args(&[
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "BatchMode=yes",
                    "-o", "ConnectTimeout=3",
                    "-i", &temp_key_path,
                    &format!("{}@{}", server.ssh_user, server.ip),
                    cmd
                ])
                .output()
                .await
        }
    };

    let output_res = tokio::time::timeout(std::time::Duration::from_secs(25), run_future).await;
    let _ = std::fs::remove_file(&temp_key_path);

    let output = match output_res {
        Ok(Ok(out)) => out,
        _ => return Err((StatusCode::GATEWAY_TIMEOUT, "Server cavab vermədi və ya SSH vaxtı keçdi".to_string())),
    };

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        let out = String::from_utf8_lossy(&output.stdout).to_string();
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Docker volumları oxunarkən xəta: {}\n{}", out, err)));
    }

    let result_str = String::from_utf8_lossy(&output.stdout);
    let sections: Vec<&str> = result_str.split("---").collect();

    let mut volumes_map = std::collections::HashMap::new();
    if let Some(vol_section) = sections.get(0) {
        for line in vol_section.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 1 {
                let name = parts[0].to_string();
                let driver = parts.get(1).unwrap_or(&"local").to_string();
                volumes_map.insert(name.clone(), serde_json::json!({
                    "name": name,
                    "driver": driver,
                    "size": "0B",
                    "containers": Vec::<String>::new()
                }));
            }
        }
    }

    if let Some(mount_section) = sections.get(1) {
        for line in mount_section.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let container_name = parts[0].to_string();
                for vol_name in &parts[1..] {
                    if let Some(vol_val) = volumes_map.get_mut(*vol_name) {
                        if let Some(arr) = vol_val.get_mut("containers").and_then(|c| c.as_array_mut()) {
                            arr.push(serde_json::json!(container_name));
                        }
                    }
                }
            }
        }
    }

    if let Some(size_section) = sections.get(2) {
        for line in size_section.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let name = parts[0];
                let size = parts[1];
                if let Some(vol_val) = volumes_map.get_mut(name) {
                    if let Some(obj) = vol_val.as_object_mut() {
                        obj.insert("size".to_string(), serde_json::json!(size));
                    }
                }
            }
        }
    }

    let mut total_disk = "Unknown".to_string();
    let mut free_disk = "Unknown".to_string();
    let mut used_percent = "Unknown".to_string();

    if let Some(disk_section) = sections.get(3) {
        let parts: Vec<&str> = disk_section.trim().split_whitespace().collect();
        if parts.len() >= 3 {
            total_disk = parts[0].to_string();
            free_disk = parts[1].to_string();
            used_percent = parts[2].to_string();
        }
    }

    let mut containers_list = Vec::new();
    if let Some(containers_section) = sections.get(4) {
        for line in containers_section.lines() {
            let parts: Vec<&str> = line.split(":::").collect();
            if parts.len() >= 2 {
                let name = parts[0].to_string();
                let size = parts[1].to_string();
                containers_list.push(serde_json::json!({
                    "name": name,
                    "size": size
                }));
            }
        }
    }

    let volumes_list: Vec<serde_json::Value> = volumes_map.into_values().collect();
    Ok(Json(serde_json::json!({
        "volumes": volumes_list,
        "containers": containers_list,
        "disk": {
            "total": total_disk,
            "free": free_disk,
            "used_percent": used_percent
        }
    })))
}

async fn delete_server_volume(
    State(state): State<AppState>,
    AxumPath((server_id, volume_name)): AxumPath<(String, String)>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = format!("temp_delvol_key_{}.key", uuid::Uuid::new_v4());
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    if let Err(e) = std::fs::write(&temp_key_path, &key_content) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write key: {}", e)));
    }

    #[cfg(target_os = "windows")]
    {
        let domain = std::env::var("USERDOMAIN").unwrap_or_default();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let identity = if domain.is_empty() { user } else { format!("{}\\{}", domain, user) };
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/inheritance:r"]).output();
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("chmod").args(&["600", &temp_key_path]).output();
    }

    let cmd = format!("sudo docker volume rm {}", volume_name);
    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };

    let run_future = async {
        if server.ip == "local" || server.ip == "127.0.0.1" {
            let local_cmd = cmd.replace("sudo ", "");
            if cfg!(target_os = "windows") {
                tokio::process::Command::new("powershell")
                    .args(&["-Command", &local_cmd])
                    .output()
                    .await
            } else {
                tokio::process::Command::new("sh")
                    .arg("-c")
                    .arg(&local_cmd)
                    .output()
                    .await
            }
        } else {
            tokio::process::Command::new(ssh_bin)
                .args(&[
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "BatchMode=yes",
                    "-o", "ConnectTimeout=5",
                    "-i", &temp_key_path,
                    &format!("{}@{}", server.ssh_user, server.ip),
                    &cmd
                ])
                .output()
                .await
        }
    };

    let output_res = tokio::time::timeout(std::time::Duration::from_secs(25), run_future).await;
    let _ = std::fs::remove_file(&temp_key_path);

    let output = match output_res {
        Ok(Ok(out)) => out,
        _ => return Err((StatusCode::GATEWAY_TIMEOUT, "Server cavab vermədi və ya SSH vaxtı keçdi".to_string())),
    };

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Volumu silmək mümkün olmadı (Bəlkə hansısa konteyner hələ də istifadə edir?): {}", err)));
    }

    Ok(Json(true))
}

#[derive(serde::Deserialize)]
struct GithubTokenInput {
    token: String,
}

async fn get_github_token(State(state): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'github_token'")
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let token = row.map(|r| r.0).unwrap_or_default();
    Ok(Json(serde_json::json!({ "token": token })))
}

async fn save_github_token(
    State(state): State<AppState>,
    Json(input): Json<GithubTokenInput>,
) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('github_token', ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .bind(&input.token)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Token yadda saxlandıqda avtomatik olaraq konteyner daxilində GHCR login edirik
    perform_docker_login(&input.token).await;

    Ok(Json(true))
}

async fn list_activity_logs(State(state): State<AppState>) -> Result<Json<Vec<ActivityLog>>, (StatusCode, String)> {
    let logs = sqlx::query_as::<_, ActivityLog>("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 30")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(logs))
}

async fn create_activity_log(
    State(state): State<AppState>,
    Json(input): Json<CreateActivityLogInput>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO activity_logs (id, message, log_type) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&input.message)
        .bind(&input.log_type)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

async fn clear_activity_logs(State(state): State<AppState>) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query("DELETE FROM activity_logs")
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

async fn get_runtime_logs(
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

    let temp_key_path = format!("temp_logs_key_{}.key", uuid::Uuid::new_v4());
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    if let Err(e) = std::fs::write(&temp_key_path, &key_content) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write key: {}", e)));
    }

    #[cfg(target_os = "windows")]
    {
        let domain = std::env::var("USERDOMAIN").unwrap_or_default();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let identity = if domain.is_empty() { user } else { format!("{}\\{}", domain, user) };
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

async fn run_ssh_command(server: &Server, cmd: &str) -> Result<String, String> {
    let temp_key_path = format!("temp_cmd_key_{}.key", uuid::Uuid::new_v4());
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    if let Err(e) = std::fs::write(&temp_key_path, &key_content) {
        return Err(format!("Failed to write key: {}", e));
    }

    #[cfg(target_os = "windows")]
    {
        let domain = std::env::var("USERDOMAIN").unwrap_or_default();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let identity = if domain.is_empty() { user } else { format!("{}\\{}", domain, user) };
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

async fn stop_application(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, String)> {
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

    let cmd = format!("sudo docker stop {}", app.name);
    let ssh_res = run_ssh_command(&server, &cmd).await;

    // Həmişə statusu bazada yeniləyirik ki, UI blokda qalmasın
    let _ = sqlx::query("UPDATE applications SET status = 'stopped' WHERE id = ?")
        .bind(&app_id)
        .execute(&state.db)
        .await;

    match ssh_res {
        Ok(_) => Ok(Json(true)),
        Err(err) => Err((StatusCode::BAD_REQUEST, format!("SSH xətası (amma status stopped edildi): {}", err))),
    }
}

async fn restart_application(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, String)> {
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

    let cmd = format!("sudo docker restart {}", app.name);
    let ssh_res = run_ssh_command(&server, &cmd).await;

    // Restart uğurludursa running, yoxsa yenə stopped saxlayaq
    let new_status = if ssh_res.is_ok() { "running" } else { "stopped" };
    let _ = sqlx::query("UPDATE applications SET status = ? WHERE id = ?")
        .bind(new_status)
        .bind(&app_id)
        .execute(&state.db)
        .await;

    match ssh_res {
        Ok(_) => Ok(Json(true)),
        Err(err) => Err((StatusCode::BAD_REQUEST, format!("SSH xətası: {}", err))),
    }
}

async fn setup_server(

    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = format!("temp_setup_key_{}.key", uuid::Uuid::new_v4());
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    if let Err(e) = std::fs::write(&temp_key_path, &key_content) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to write key: {}", e)));
    }

    #[cfg(target_os = "windows")]
    {
        let domain = std::env::var("USERDOMAIN").unwrap_or_default();
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let identity = if domain.is_empty() { user } else { format!("{}\\{}", domain, user) };
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/inheritance:r"]).output();
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("chmod").args(&["600", &temp_key_path]).output();
    }

    let cmd = "
        if [ ! -f /swapfile ]; then
            sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048;
            sudo chmod 600 /swapfile;
            sudo mkswap /swapfile;
            sudo swapon /swapfile;
            grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab;
        fi;
        sudo sysctl vm.swappiness=10;
        grep -q 'vm.swappiness=10' /etc/sysctl.conf || echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf;
        if ! command -v docker > /dev/null 2>&1; then 
            curl -fsSL https://get.docker.com -o get-docker.sh; 
            sudo sh get-docker.sh; 
            sudo systemctl enable docker; 
            sudo systemctl start docker; 
        fi;
        if ! command -v git > /dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y git;
        fi;
        if ! command -v node > /dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg;
            sudo mkdir -p /etc/apt/keyrings;
            curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg || true;
            echo \"deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main\" | sudo tee /etc/apt/sources.list.d/nodesource.list;
            sudo apt-get update && sudo apt-get install -y nodejs;
        fi;
        sudo mkdir -p /data/masterdeploy/apps;
        sudo chown -R $USER:$USER /data/masterdeploy;
        echo 'Setup Complete';
    ";

    let output = if server.ip == "local" || server.ip == "127.0.0.1" {
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
    let output = output;

    let _ = std::fs::remove_file(&temp_key_path);

    match output {
        Ok(out) if out.status.success() => Ok(Json(true)),
        Ok(out) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("SSH command failed: {}", String::from_utf8_lossy(&out.stderr)),
        )),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to execute ssh: {}", e))),
    }
}

async fn list_applications(State(state): State<AppState>) -> Result<Json<Vec<Application>>, (StatusCode, String)> {
    let apps = sqlx::query_as::<_, Application>(
        "SELECT id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, \
         build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, \
         privileged, memory_limit, cpu_limit, \
         CAST(created_at AS TEXT) as created_at, CAST(updated_at AS TEXT) as updated_at, \
         last_commit_hash, cloudflare_url, cf_worker_url, deploy_type, registry_image \
         FROM applications ORDER BY created_at DESC"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(apps))
}

async fn create_application(State(state): State<AppState>, Json(input): Json<CreateApplicationInput>) -> Result<(StatusCode, Json<Application>), (StatusCode, String)> {
    let id = Uuid::new_v4().to_string();
    let bp_type = input.build_pack_type.clone().unwrap_or_else(|| "dockerfile".to_string());
    let dep_type = input.deploy_type.clone().unwrap_or_else(|| "git".to_string());
    
    sqlx::query(
        "INSERT INTO applications (
            id, name, repo_url, branch, port, server_id, status, env_vars,
            build_pack_type, build_command, run_command, dockerfile_path,
            entrypoint, command, target, work_dir, privileged, memory_limit, cpu_limit,
            deploy_type, registry_image
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let app = Application {
        id: id.clone(),
        name: input.name,
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
        created_at: String::new(),
        updated_at: String::new(),
    };
    
    Ok((StatusCode::CREATED, Json(app)))
}

async fn get_application(State(state): State<AppState>, AxumPath(app_id): AxumPath<String>) -> Result<Json<Application>, (StatusCode, String)> {
    let app = sqlx::query_as::<_, Application>(
        "SELECT id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, \
         build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, \
         privileged, memory_limit, cpu_limit, \
         CAST(created_at AS TEXT) as created_at, CAST(updated_at AS TEXT) as updated_at, \
         last_commit_hash, cloudflare_url, cf_worker_url, deploy_type, registry_image \
         FROM applications WHERE id = ?"
    )
    .bind(&app_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Application not found".to_string()))?;
    Ok(Json(app))
}

async fn update_application(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
    Json(input): Json<crate::models::UpdateApplicationInput>,
) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query(
        "UPDATE applications SET 
            repo_url = ?, branch = ?, port = ?, env_vars = ?, build_pack_type = ?, 
            build_command = ?, run_command = ?, dockerfile_path = ?, entrypoint = ?, 
            command = ?, target = ?, work_dir = ?, privileged = ?, memory_limit = ?, cpu_limit = ?,
            cf_worker_url = ?, deploy_type = ?, registry_image = ?,
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
    .bind(&app_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(true))
}

async fn delete_application(State(state): State<AppState>, AxumPath(app_id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
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

    // 1. Docker konteynerini serverdən silirik (asinxron arxa planda)
    let cleanup_cmd = format!("sudo docker rm -f {} || true", app.name);
    let server_clone = server.clone();
    tokio::spawn(async move {
        let _ = run_ssh_command(&server_clone, &cleanup_cmd).await;
    });

    let mut tx = state.db.begin().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 2. Delete all deployments of this application
    sqlx::query("DELETE FROM deployments WHERE application_id = ?")
        .bind(&app_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 3. Delete the application itself
    sqlx::query("DELETE FROM applications WHERE id = ?")
        .bind(&app_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

async fn cancel_deployment(State(state): State<AppState>, AxumPath(deploy_id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
    let deployment = sqlx::query_as::<_, Deployment>("SELECT * FROM deployments WHERE id = ?")
        .bind(&deploy_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Deployment not found".to_string()))?;

    sqlx::query("UPDATE deployments SET status = 'cancelled' WHERE id = ?")
        .bind(&deploy_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("UPDATE applications SET status = 'stopped' WHERE id = ?")
        .bind(&deployment.application_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(true))
}

async fn list_deployments(State(state): State<AppState>, AxumPath(app_id): AxumPath<String>) -> Result<Json<Vec<Deployment>>, (StatusCode, String)> {
    let deployments = sqlx::query_as::<_, Deployment>("SELECT id, application_id, status, logs, CAST(created_at AS TEXT) as created_at FROM deployments WHERE application_id = ? ORDER BY created_at DESC")
        .bind(&app_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| {
            println!("DB ERROR in list_deployments: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;
    Ok(Json(deployments))
}

async fn get_deployment(State(state): State<AppState>, AxumPath(deploy_id): AxumPath<String>) -> Result<Json<Deployment>, (StatusCode, String)> {
    let deployment = sqlx::query_as::<_, Deployment>(
        "SELECT id, application_id, status, logs, CAST(created_at AS TEXT) as created_at \
         FROM deployments WHERE id = ?"
    )
    .bind(&deploy_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "Deployment not found".to_string()))?;
    Ok(Json(deployment))
}

async fn update_logs_helper(db: &SqlitePool, dep_id: &str, text: &str) {
    let _ = sqlx::query("UPDATE deployments SET logs = ? WHERE id = ?")
        .bind(text)
        .bind(dep_id)
        .execute(db)
        .await;
}

async fn finalize_deploy(db: &SqlitePool, deploy_id: &str, app_id: &str, status: &str) {
    let _ = sqlx::query("UPDATE deployments SET status = ? WHERE id = ?")
        .bind(status)
        .bind(deploy_id)
        .execute(db)
        .await;

    if status == "success" {
        // Əvvəlki bütün uğurlu deploy-ları 'stopped' edirik
        let _ = sqlx::query("UPDATE deployments SET status = 'stopped' WHERE application_id = ? AND status = 'success' AND id != ?")
            .bind(app_id)
            .bind(deploy_id)
            .execute(db)
            .await;
    }

    let app_status = if status == "success" { "running" } else { "failed" };
    let _ = sqlx::query("UPDATE applications SET status = ? WHERE id = ?")
        .bind(app_status)
        .bind(app_id)
        .execute(db)
        .await;

    // Uğurlu deploy olduqda ən son commit SHA-nı alıb yadda saxlayırıq
    if status == "success" {
        if let Ok(Some(app)) = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?").bind(app_id).fetch_optional(db).await {
            // git ls-remote ilə son commit-i öyrənirik
            let output = std::process::Command::new("git")
                .args(["ls-remote", &app.repo_url, &app.branch])
                .output();
            if let Ok(out) = output {
                if out.status.success() {
                    let result_str = String::from_utf8_lossy(&out.stdout);
                    if let Some(sha) = result_str.split_whitespace().next() {
                        let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                            .bind(sha)
                            .bind(app_id)
                            .execute(db)
                            .await;
                    }
                }
            }
        }
    }
}

async fn run_ssh_cmd_stream_helper(
    key_path: String,
    user: String,
    ip: String,
    cmd: String,
    db: SqlitePool,
    deploy_id: String,
    logs: std::sync::Arc<tokio::sync::Mutex<String>>,
) -> Result<bool, std::io::Error> {
    use tokio::io::AsyncBufReadExt;
    let mut child = if ip == "local" || ip == "127.0.0.1" {
        let local_cmd = cmd.replace("sudo ", "");
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&local_cmd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?
    } else {
        let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };
        tokio::process::Command::new(ssh_bin)
            .args(&[
                "-o", "StrictHostKeyChecking=no",
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=15",
                "-o", "ServerAliveInterval=3",
                "-o", "ServerAliveCountMax=2",
                "-i", &key_path,
                &format!("{}@{}", user, ip),
                &cmd
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?
    };

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let mut stdout_reader = tokio::io::BufReader::new(stdout).lines();
    let mut stderr_reader = tokio::io::BufReader::new(stderr).lines();

    let db_clone = db.clone();
    let deploy_id_clone = deploy_id.clone();
    let logs_clone = logs.clone();

    // Read both streams in parallel
    loop {
        // Hər dövrdə ləğv edilmə statusunu yoxlayırıq
        if let Ok(Some((status,))) = sqlx::query_as::<_, (String,)>("SELECT status FROM deployments WHERE id = ?")
            .bind(&deploy_id_clone)
            .fetch_optional(&db_clone)
            .await 
        {
            if status == "cancelled" {
                let _ = child.kill().await;
                return Ok(false);
            }
        }

        tokio::select! {
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        let mut lock = logs_clone.lock().await;
                        lock.push_str(&format!("{}\n", l));
                        update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                    }
                    Ok(None) => break, // axın bitti
                    Err(_) => break,
                }
            }
            line = stderr_reader.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        let mut lock = logs_clone.lock().await;
                        lock.push_str(&format!("{}\n", l));
                        update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                    }
                    Ok(None) => break, // axın bitti
                    Err(_) => break,
                }
            }
            status = child.wait() => {
                let exit_status = status?;
                // Read remaining output
                while let Ok(Some(l)) = stdout_reader.next_line().await {
                    let mut lock = logs_clone.lock().await;
                    lock.push_str(&format!("{}\n", l));
                    update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                }
                while let Ok(Some(l)) = stderr_reader.next_line().await {
                    let mut lock = logs_clone.lock().await;
                    lock.push_str(&format!("{}\n", l));
                    update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                }
                return Ok(exit_status.success());
            }
        }
    }
    
    let exit_status = child.wait().await?;
    Ok(exit_status.success())
}

#[derive(serde::Deserialize)]
pub struct DeployQuery {
    pub no_cache: Option<bool>,
}

async fn trigger_deployment(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
    Query(query): Query<DeployQuery>,
) -> Result<Json<Deployment>, (StatusCode, String)> {
    let no_cache = query.no_cache.unwrap_or(false);
    match trigger_deployment_impl(state.db, app_id, no_cache).await {
        Ok(dep) => Ok(Json(dep)),
        Err(err) => Err((StatusCode::INTERNAL_SERVER_ERROR, err)),
    }
}

async fn trigger_deployment_impl(
    db: SqlitePool,
    app_id: String,
    no_cache: bool,
) -> Result<Deployment, String> {
    let id = Uuid::new_v4().to_string();
    
    // Fetch application details to get server connection info
    let app = match sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
        .bind(&app_id)
        .fetch_optional(&db)
        .await
    {
        Ok(Some(a)) => a,
        Ok(None) => return Err("Application not found".to_string()),
        Err(e) => return Err(e.to_string()),
    };

    let server = match sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&app.server_id)
        .fetch_optional(&db)
        .await
    {
        Ok(Some(s)) => s,
        Ok(None) => return Err("Target server not found".to_string()),
        Err(e) => return Err(e.to_string()),
    };

    // Həmin layihə üçün hazırda işləyən hər hansı başqa building/deploying deploy varsa, onu cancel edirik
    let _ = sqlx::query("UPDATE deployments SET status = 'cancelled' WHERE application_id = ? AND (status = 'building' || status = 'deploying')")
        .bind(&app_id)
        .execute(&db)
        .await;

    // Create new deployment record
    let deployment = Deployment {
        id: id.clone(),
        application_id: app_id.clone(),
        status: "building".to_string(),
        logs: "Starting deployment...\n".to_string(),
        created_at: String::new(),
    };

    if let Err(e) = sqlx::query(
        "INSERT INTO deployments (id, application_id, status, logs) VALUES (?, ?, ?, ?)"
    )
    .bind(&deployment.id)
    .bind(&deployment.application_id)
    .bind(&deployment.status)
    .bind(&deployment.logs)
    .execute(&db)
    .await {
        return Err(e.to_string());
    }

    // Update application status
    if let Err(e) = sqlx::query("UPDATE applications SET status = 'deploying' WHERE id = ?")
        .bind(&app_id)
        .execute(&db)
        .await {
            return Err(e.to_string());
        }

    // Spawn background task to perform actual SSH commands
    let db_clone = db.clone();
    let deploy_id = id.clone();
    let app_id_clone = app_id.clone();
    
    tokio::spawn(async move {
        let logs = std::sync::Arc::new(tokio::sync::Mutex::new(format!("Connecting to server {} ({})...\n", server.name, server.ip)));
        {
            let lock = logs.lock().await;
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }

        // Write the SSH private key temporarily to disk safely
        let temp_key_path = format!("temp_key_{}.key", deploy_id);
        
        let key_content = if server.ssh_key.contains("BEGIN ") {
            server.ssh_key.clone()
        } else {
            std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
        };

        if let Err(e) = std::fs::write(&temp_key_path, &key_content) {
            let mut lock = logs.lock().await;
            lock.push_str(&format!("[FATAL ERROR] Failed to write temporary SSH key: {}\n", e));
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
            finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
            return;
        }

        #[cfg(target_os = "windows")]
        {
            let domain = std::env::var("USERDOMAIN").unwrap_or_default();
            let user = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
            let identity = if domain.is_empty() { user } else { format!("{}\\{}", domain, user) };
            let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/inheritance:r"]).output();
            let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("chmod").args(&["600", &temp_key_path]).output();
        }

        // Step 0: Port Toqquşması və Firewall (UFW) Yoxlanışı
        {
            let mut lock = logs.lock().await;
            lock.push_str(&format!("[0/5] Port toqquşması və Firewall icazəsi yoxlanılır (Port: {})...\n", app.port));
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }

        let port_check_cmd = format!(
            "if sudo ss -tuln | grep -q \":{} \"; then \
                # Əgər portu istifadə edən elə bu tətbiqdirsə (update/redeploy), toqquşma saymırıq \
                if sudo docker ps --filter \"name={}\" --format \"{{{{.Ports}}}}\" | grep -q \"{}\"; then \
                    echo \"===PORT_OK===\"; \
                else \
                    echo \"===PORT_CONFLICT===\"; \
                fi; \
             elif sudo ufw status | grep -q \"Status: active\" && ! sudo ufw status | grep -q \"{}/tcp\"; then \
                echo \"===FIREWALL_BLOCKED===\"; \
             else \
                echo \"===PORT_OK===\"; \
             fi",
            app.port, app.name, app.port, app.port
        );

        let mut port_ok = false;
        let mut err_msg = String::new();

        // SSH üzərindən port statusunu öyrənirik
        let check_logs = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
        let _ = run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), port_check_cmd, db_clone.clone(), deploy_id.clone(), check_logs.clone()).await;
        
        let check_output = check_logs.lock().await;
        if check_output.contains("===PORT_CONFLICT===") {
            err_msg = format!("[ERROR] Port {} artıq başqa bir xidmət tərəfindən istifadə olunur! Başqa port seçin.\n", app.port);
        } else if check_output.contains("===FIREWALL_BLOCKED===") {
            err_msg = format!("[ERROR] Port {} uzaq server firewall-u (UFW) tərəfindən bloklanıb! Zəhmət olmasa portu açın.\n", app.port);
        } else {
            port_ok = true;
        }

        if !port_ok {
            let mut lock = logs.lock().await;
            lock.push_str(&err_msg);
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
            let _ = std::fs::remove_file(&temp_key_path);
            finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
            return;
        }

        {
            let mut lock = logs.lock().await;
            lock.push_str("✅ Port yoxlanışı uğurla keçdi (Port toqquşması və ya bloklanma yoxdur).\n");
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }

        // Step 1: Ensure workspace dir and install git/docker if needed
        {
            let mut lock = logs.lock().await;
            lock.push_str("[1/5] Preparing uzaq server directory & requirements...\n");
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }
        
        let prep_cmd = "sudo mkdir -p /data/masterdeploy/apps && sudo chown -R $USER:$USER /data/masterdeploy".to_string();
        match run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), prep_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await {
            Ok(true) => {
                let mut lock = logs.lock().await;
                lock.push_str("[SUCCESS] Workspace directory created.\n");
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
            }
            _ => {
                let mut lock = logs.lock().await;
                lock.push_str("[ERROR] Directory prep failed.\n");
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
                let _ = std::fs::remove_file(&temp_key_path);
                finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
                return;
            }
        }

        let deploy_type = app.deploy_type.clone().unwrap_or_else(|| "git".to_string());
        if deploy_type == "image" {
            // Registry İmic yayımlanırsa: Git və Build addımları əvəzinə yalnız pull edirik
            let reg_img = app.registry_image.clone().unwrap_or_default();
            {
                let mut lock = logs.lock().await;
                lock.push_str(&format!("[2/5] Registry imici uzaq serverə çəkilir (Image: {})...\n", reg_img));
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
            }

            // GitHub tokenini oxuyuruq ki, uzaq serverdə GHCR-a login olaq
            let token_row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'github_token'")
                .fetch_optional(&db_clone)
                .await
                .unwrap_or_default();
            let github_token = token_row.map(|r| r.0).unwrap_or_default();

            let login_cmd = if !github_token.is_empty() {
                format!("echo '{}' | sudo docker login ghcr.io -u kral14 --password-stdin", github_token)
            } else {
                "echo '[INFO] GitHub token tapılmadı, anonim pull cəhdi edilir...'".to_string()
            };

            {
                let mut lock = logs.lock().await;
                lock.push_str("[DEBUG] GHCR-a daxil olunur (docker login)...\n");
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
            }

            let _ = run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), login_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await;

            let pull_cmd = format!("sudo docker pull {}", reg_img);
            match run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), pull_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await {
                Ok(true) => {
                    let mut lock = logs.lock().await;
                    lock.push_str("[SUCCESS] Registry imici uğurla çəkildi.\n");
                    lock.push_str("[3/5] Docker build mərhələsi keçildi (Hazır imic istifadə olunur).\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                }
                _ => {
                    let mut lock = logs.lock().await;
                    lock.push_str("[ERROR] Docker pull command failed. Registry imici mövcud deyil və ya giriş icazəsi yoxdur.\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                    let _ = std::fs::remove_file(&temp_key_path);
                    finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
                    return;
                }
            }
        } else {
            // Köhnə Git Build üsulu:
            // Step 2: Clone or Pull Git repository
            {
                let mut lock = logs.lock().await;
                lock.push_str(&format!("[2/5] Git repository klonlanır (Branch: {})...\n", app.branch));
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
            }
            
            let git_cmd = format!(
                "if [ -d \"/data/masterdeploy/apps/{}\" ]; then cd /data/masterdeploy/apps/{} && git fetch --all && git reset --hard origin/{}; else git clone -b {} {} /data/masterdeploy/apps/{}; fi",
                app.name, app.name, app.branch, app.branch, app.repo_url, app.name
            );
            
            match run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), git_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await {
                Ok(true) => {
                    let mut lock = logs.lock().await;
                    lock.push_str("[SUCCESS] Repository cloned/updated successfully.\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                }
                _ => {
                    let mut lock = logs.lock().await;
                    lock.push_str("[ERROR] Git command execution failed.\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                    let _ = std::fs::remove_file(&temp_key_path);
                    finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
                    return;
                }
            }

            // Step 3: Build Docker Image
            {
                let mut lock = logs.lock().await;
                lock.push_str("[3/5] Docker image build prosesi başladılır...\n");
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
            }

            let build_pack_type = app.build_pack_type.clone().unwrap_or_else(|| "dockerfile".to_string());
            
            let build_cmd = if build_pack_type == "buildpack" {
                {
                    let mut lock = logs.lock().await;
                    lock.push_str("Buildpack seçilib. Layihə tipi təyin olunur...\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                }

                let bc = app.build_command.clone().unwrap_or_default();
                let rc = app.run_command.clone().unwrap_or_default();
                
                format!(
                    "cd /data/masterdeploy/apps/{} && \
                     if [ -f package.json ]; then \
                         echo 'Node.js project detected.'; \
                         BUILD_CMD=\"{}\"; [ -z \"$BUILD_CMD\" ] && ( grep -q '\"build\":' package.json && BUILD_CMD=\"npm install && npm run build\" || BUILD_CMD=\"npm install\" ); \
                         RUN_CMD=\"{}\"; [ -z \"$RUN_CMD\" ] && RUN_CMD=\"npm start\"; \
                         echo -e \"FROM node:20-alpine AS builder\\nWORKDIR /app\\nCOPY . .\\nRUN $BUILD_CMD\\nFROM node:20-alpine\\nWORKDIR /app\\nCOPY --from=builder /app .\\nEXPOSE {}\\nCMD $RUN_CMD\" > Dockerfile; \
                     elif [ -f requirements.txt ]; then \
                         echo 'Python project detected.'; \
                         BUILD_CMD=\"{}\"; [ -z \"$BUILD_CMD\" ] && BUILD_CMD=\"pip install --no-cache-dir -r requirements.txt\"; \
                         RUN_CMD=\"{}\"; [ -z \"$RUN_CMD\" ] && ( [ -f main.py ] && RUN_CMD=\"python main.py\" || RUN_CMD=\"python app.py\" ); \
                         echo -e \"FROM python:3.11-slim\\nWORKDIR /app\\nCOPY . .\\nRUN $BUILD_CMD\\nEXPOSE {}\\nCMD $RUN_CMD\" > Dockerfile; \
                     elif [ -f go.mod ]; then \
                         echo 'Go project detected.'; \
                         BUILD_CMD=\"{}\"; [ -z \"$BUILD_CMD\" ] && BUILD_CMD=\"go build -o main .\"; \
                         RUN_CMD=\"{}\"; [ -z \"$RUN_CMD\" ] && RUN_CMD=\"./main\"; \
                         echo -e \"FROM golang:1.21-alpine AS builder\\nWORKDIR /app\\nCOPY . .\\nRUN $BUILD_CMD\\nFROM alpine:latest\\nWORKDIR /app\\nCOPY --from=builder /app/main .\\nEXPOSE {}\\nCMD $RUN_CMD\" > Dockerfile; \
                     elif [ -f Cargo.toml ]; then \
                         echo 'Rust project detected.'; \
                         BUILD_CMD=\"{}\"; [ -z \"$BUILD_CMD\" ] && BUILD_CMD=\"cargo build --release -j 1\"; \
                         RUN_CMD=\"{}\"; [ -z \"$RUN_CMD\" ] && RUN_CMD=\"./target/release/$(sed -n 's/^name *= *\"\\(.*\\)\"/\\1/p' Cargo.toml | head -n 1)\"; \
                         rm -f Cargo.lock; \
                         echo -e \"FROM rust:1-slim AS builder\\nRUN apt-get update && apt-get install -y pkg-config libssl-dev\\nWORKDIR /app\\nCOPY . .\\nRUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/app/target $BUILD_CMD && cp $RUN_CMD ./app_bin\\nFROM debian:bookworm-slim\\nRUN apt-get update && apt-get install -y libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*\\nWORKDIR /app\\nCOPY --from=builder /app/app_bin ./app_bin\\nEXPOSE {}\\nCMD [\\\"./app_bin\\\"]\" > Dockerfile; \
                     else \
                         echo 'Fallback static/generic server.'; \
                         echo -e \"FROM alpine:latest\\nRUN apk add --no-cache curl\\nCMD [\\\"sleep\\\", \\\"3600\\\"]\" > Dockerfile; \
                     fi && DOCKER_BUILDKIT=0 sudo docker build {} -t {}:latest .",
                    app.name, 
                    bc, rc, app.port,
                    bc, rc, app.port,
                    bc, rc, app.port,
                    bc, rc, app.port,
                    if no_cache { "--no-cache" } else { "" },
                    app.name
                )
            } else {
                let df_path = app.dockerfile_path.clone().unwrap_or_default();
                let df_file = if df_path.trim().is_empty() { "Dockerfile".to_string() } else { df_path.trim().to_string() };
                
                let target_arg = if let Some(ref t) = app.target {
                    if !t.trim().is_empty() {
                        format!("--target {} ", t.trim())
                    } else {
                        "".to_string()
                    }
                } else {
                    "".to_string()
                };
                
                let cache_flag = if no_cache { "--no-cache" } else { "" };
                
                format!(
                    "cd /data/masterdeploy/apps/{} && ( [ -f \"{}\" ] || echo -e 'FROM alpine\\nRUN apk add --no-cache curl\\nCMD [\"sleep\", \"3600\"]' > \"{}\" ) && DOCKER_BUILDKIT=0 sudo docker build {} {} -f \"{}\" -t {}:latest .",
                    app.name, df_file, df_file, target_arg, cache_flag, df_file, app.name
                )
            };
            
            match run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), build_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await {
                Ok(true) => {
                    let mut lock = logs.lock().await;
                    lock.push_str("[SUCCESS] Docker image yığıldı (built).\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                }
                _ => {
                    let mut lock = logs.lock().await;
                    lock.push_str("[ERROR] Docker build failed.\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                    let _ = std::fs::remove_file(&temp_key_path);
                    finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
                    return;
                }
            }
        }

        // Step 4: Stop and Remove Old Container (if exists)
        {
            let mut lock = logs.lock().await;
            lock.push_str("[4/5] Köhnə konteynerlər təmizlənir...\n");
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }
        
        // Köhnə konteynerin işlətdiyi imicin SHA və Tarix məlumatını çəkirik
        let inspect_old_cmd = format!(
            "sudo docker inspect --format 'SHA: {{{{.Image}}}} | İmic: {{{{.Config.Image}}}} | Yaradılma: {{{{.Created}}}} | Başlama: {{{{.State.StartedAt}}}}' {} 2>/dev/null || echo 'Tapılmadı'",
            app.name
        );
        let old_image_logs = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
        let _ = run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), inspect_old_cmd, db_clone.clone(), deploy_id.clone(), old_image_logs.clone()).await;
        let old_image_info = old_image_logs.lock().await.trim().to_string();
        if !old_image_info.is_empty() && old_image_info != "Tapılmadı" {
            let mut lock = logs.lock().await;
            lock.push_str(&format!("[INFO] Köhnə versiya məlumatı:\n  {}\n", old_image_info));
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }

        let cleanup_cmd = format!(
            "sudo docker rm -f {} || true",
            app.name
        );
        
        let _ = run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), cleanup_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await;

        // Step 5: Start New Docker Container
        {
            let mut lock = logs.lock().await;
            lock.push_str(&format!("[5/5] Yeni konteyner işə salınır (Port: {})... \n", app.port));
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }
        
        let mut env_args = String::new();
        let mut has_port_env = false;
        if let Some(ref env_vars_str) = app.env_vars {
            for line in env_vars_str.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if trimmed.contains('=') {
                    if trimmed.starts_with("PORT=") {
                        has_port_env = true;
                    }
                    // Tək dırnaqlardan istifadə edirik ki, bash/sh $ kimi xüsusi simvolları dəyişən kimi oxumasın
                    let escaped = trimmed.replace("'", "'\\''");
                    env_args.push_str(&format!(" -e '{}'", escaped));
                }
            }
        }
        if !has_port_env {
            env_args.push_str(&format!(" -e PORT={}", app.port));
        }
        
        let deploy_type = app.deploy_type.clone().unwrap_or_else(|| "git".to_string());
        let image_target = if deploy_type == "image" {
            app.registry_image.clone().unwrap_or_else(|| format!("{}:latest", app.name))
        } else {
            format!("{}:latest", app.name)
        };

        let run_cmd = format!(
            "sudo docker rm -f {} || true && sudo docker run -d --name {} --restart always -p {}:{} {} {}",
            app.name, app.name, app.port, app.port, env_args, image_target
        );
        
        match run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), run_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await {
            Ok(true) => {
                // Yeni başladılmış konteynerin SHA, yaradılma və işə düşmə tarixini çəkirik
                let inspect_new_cmd = format!(
                    "sudo docker inspect --format 'SHA: {{{{.Image}}}} | Yaradılma: {{{{.Created}}}} | Başlama: {{{{.State.StartedAt}}}}' {} 2>/dev/null || echo 'Tapılmadı'",
                    app.name
                );
                let new_image_logs = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
                let _ = run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), inspect_new_cmd, db_clone.clone(), deploy_id.clone(), new_image_logs.clone()).await;
                let new_image_info = new_image_logs.lock().await.trim().to_string();
                
                {
                    let mut lock = logs.lock().await;
                    if !new_image_info.is_empty() && new_image_info != "Tapılmadı" {
                        lock.push_str(&format!("[INFO] Qurulan yeni versiya məlumatı:\n  {}\n", new_image_info));
                    }
                    lock.push_str("[SUCCESS] Tətbiq uğurla deploy olundu! 🎉\n");
                    lock.push_str("[CLEANUP] Köhnə Docker image-ları təmizlənir...\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                }
                // Dangling image-ları sil (build cache-ə toxunma)
                let _ = run_ssh_cmd_stream_helper(
                    temp_key_path.clone(),
                    server.ssh_user.clone(),
                    server.ip.clone(),
                    "sudo docker image prune -f".to_string(),
                    db_clone.clone(),
                    deploy_id.clone(),
                    logs.clone(),
                ).await;
                {
                    let mut lock = logs.lock().await;
                    lock.push_str("[CLEANUP] ✅ Köhnə image-lar silindi.\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                }
                finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "success").await;
            }
            _ => {
                let mut lock = logs.lock().await;
                lock.push_str("[ERROR] Docker container run failed.\n");
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
                finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
            }
        }

        // Clean up temporary key
        let _ = std::fs::remove_file(&temp_key_path);
    });

    Ok(deployment)
}

async fn get_changelog(State(state): State<AppState>) -> axum::response::Response {
    add_activity_log_impl(&state.db, "[Yenilənmə] MasterDeploy üçün mövcud panel versiyaları yoxlanılır...", "info").await;
    let url = "https://raw.githubusercontent.com/kral14/server-repo-rust/main/MasterDeploy-rust/static/changelog.json";
    let output = std::process::Command::new("curl").args(["-s", url]).output();
    let text = if let Ok(out) = output {
        String::from_utf8_lossy(&out.stdout).to_string()
    } else {
        "[]".to_string()
    };
    axum::response::Response::builder()
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(text))
        .unwrap()
}

async fn get_docs() -> axum::response::Response {
    let url = "https://raw.githubusercontent.com/kral14/server-repo-rust/main/MasterDeploy-rust/static/docs.json";
    let output = std::process::Command::new("curl").args(["-s", url]).output();
    let text = if let Ok(out) = output {
        String::from_utf8_lossy(&out.stdout).to_string()
    } else {
        "{}".to_string()
    };
    axum::response::Response::builder()
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(text))
        .unwrap()
}

#[derive(serde::Deserialize)]
struct UpdatePayload {
    version: String,
}

async fn trigger_system_update(
    State(state): State<AppState>,
    Json(payload): Json<UpdatePayload>
) -> Result<StatusCode, (StatusCode, String)> {
    let version = payload.version;
    let image = format!("ghcr.io/kral14/server-repo-rust:{}", version);
    
    // GitHub tokenimizi bazadan oxuyuruq (əgər mövcuddursa GHCR api sorğusu üçün istifadə edəcəyik)
    let token_row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'github_token'")
        .fetch_optional(&state.db)
        .await
        .unwrap_or_default();
    
    let github_token = token_row.map(|r| r.0).unwrap_or_default();

    // 1. Docker imicinin həqiqətən GHCR-da mövcud olub-olmadığını API vasitəsilə yoxlayırıq.
    // Əgər token varsa autentifikasiya olunmuş sorğu atırıq, yoxdursa ictimai sorğu atırıq.
    let mut check_success = false;
    
    if !github_token.is_empty() {
        let client = reqwest::Client::new();
        // GHCR registry-dən token almaq
        let token_url = format!("https://ghcr.io/token?scope=repository:kral14/server-repo-rust:pull");
        let token_res = client.get(&token_url)
            .header("User-Agent", "DeployMaster")
            .send()
            .await;
            
        if let Ok(res) = token_res {
            #[derive(serde::Deserialize)]
            struct GhcrToken { token: String }
            if let Ok(token_obj) = res.json::<GhcrToken>().await {
                // Manifest-i yoxlayaq
                let manifest_url = format!("https://ghcr.io/v2/kral14/server-repo-rust/manifests/{}", version);
                let manifest_res = client.head(&manifest_url)
                    .header("Authorization", format!("Bearer {}", token_obj.token))
                    .header("User-Agent", "DeployMaster")
                    .send()
                    .await;
                if let Ok(m_res) = manifest_res {
                    if m_res.status().is_success() {
                        check_success = true;
                    }
                }
            }
        }
    }

    // Əgər API yoxlanışı uğursuz olarsa və ya token yoxdursa, birbaşa "docker manifest inspect" və ya "docker pull" yoxlamağa cəhd edirik,
    // amma xəta verərsə istifadəçiyə Actions-ın hələ bitmədiyini bildiririk.
    if !check_success {
        // İkinci sürətli yoxlama üsulu: docker manifest inspect
        let inspect_status = std::process::Command::new("docker")
            .args(["manifest", "inspect", &image])
            .status();
        if let Ok(status) = inspect_status {
            if status.success() {
                check_success = true;
            }
        }
    }

    if !check_success {
        return Err((
            StatusCode::BAD_REQUEST,
            "Seçilən versiya üçün Docker imici tapılmadı (GitHub Actions build-i hələ bitməyib və ya davam edir). Zəhmət olmasa 1-2 dəqiqə gözləyin.".to_string()
        ));
    }

    // 2. Docker image pull edirik.
    let pull_status = std::process::Command::new("docker")
        .args(["pull", &image])
        .status();
        
    match pull_status {
        Ok(status) if status.success() => {
            // Cari panelin işlədiyi xarici portu öyrənirik (Inspect vasitəsilə)
            let port_output = std::process::Command::new("docker")
                .args(["inspect", "--format", "{{(index (index .NetworkSettings.Ports \"3000/tcp\") 0).HostPort}}", "masterdeploy"])
                .output();
            
            let host_port = if let Ok(out) = port_output {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            } else {
                "3000".to_string() // Fallback port
            };
            
            let host_port = if host_port.is_empty() { "3000".to_string() } else { host_port };
 
            // Cari işləyən MasterDeploy imic ID-sini tapırıq ki, onu silə bilək
            let current_image_output = std::process::Command::new("docker")
                .args(["inspect", "--format", "{{.Image}}", "masterdeploy"])
                .output();
            let current_image_id = if let Ok(out) = current_image_output {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            } else {
                "".to_string()
            };

            // Pull uğurludursa, yenilənmə skriptini işə salırıq (düzgün volume, dinamik port, köhnə imicin silinməsi və təmizlik ilə)
            let script = if !current_image_id.is_empty() {
                format!(
                    "sleep 3 && docker stop masterdeploy && docker rm masterdeploy && (docker rmi -f {} || true) && docker run -d --name masterdeploy --restart always -p {}:3000 -v /data/masterdeploy:/app/data -v /var/run/docker.sock:/var/run/docker.sock -v ~/.ssh:/root/.ssh -e PORT=3000 '{}' && docker image prune -f",
                    current_image_id, host_port, image
                )
            } else {
                format!(
                    "sleep 3 && docker stop masterdeploy && docker rm masterdeploy && docker run -d --name masterdeploy --restart always -p {}:3000 -v /data/masterdeploy:/app/data -v /var/run/docker.sock:/var/run/docker.sock -v ~/.ssh:/root/.ssh -e PORT=3000 '{}' && docker image prune -f",
                    host_port, image
                )
            };

            let _ = std::process::Command::new("docker")
                .args(["run", "-d", "--rm", "--name", "masterdeploy-updater", "-v", "/var/run/docker.sock:/var/run/docker.sock", &image, "sh", "-c", &script])
                .spawn();

            Ok(StatusCode::OK)
        }
        _ => {
            Err((StatusCode::BAD_REQUEST, "Docker pull xətası baş verdi. Yenidən cəhd edin.".to_string()))
        }
    }
}

async fn add_activity_log_impl(db: &SqlitePool, message: &str, log_type: &str) {
    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query("INSERT INTO activity_logs (id, message, log_type) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(message)
        .bind(log_type)
        .execute(db)
        .await;
}

async fn git_polling_loop(db: SqlitePool) {
    println!("[INFO] Git Auto-Deploy Polling Service is running... 🕵️");
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

        // Hər dövrdə GitHub tokenini oxuyub daxildə GHCR login-in aktiv olmasını təmin edirik
        if let Ok(Some((github_token,))) = sqlx::query_as::<_, (String,)>("SELECT value FROM settings WHERE key = 'github_token'")
            .fetch_optional(&db)
            .await 
        {
            perform_docker_login(&github_token).await;
        }

        // 30 gündən köhnə deployment qeydlərini avtomatik silirik
        let _ = sqlx::query("DELETE FROM deployments WHERE created_at < datetime('now', '-30 days')")
            .execute(&db)
            .await;
        let apps = match sqlx::query_as::<_, Application>(
            "SELECT id, name, repo_url, branch, port, server_id, status, env_vars, build_pack_type, \
             build_command, run_command, dockerfile_path, entrypoint, command, target, work_dir, \
             privileged, memory_limit, cpu_limit, \
             CAST(created_at AS TEXT) as created_at, CAST(updated_at AS TEXT) as updated_at, \
             last_commit_hash, cloudflare_url, cf_worker_url, deploy_type, registry_image \
             FROM applications"
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

            let deploy_type = app.deploy_type.clone().unwrap_or_else(|| "git".to_string());

            if deploy_type == "image" {
                let reg_image = match app.registry_image.clone() {
                    Some(img) if !img.is_empty() => img,
                    _ => continue,
                };

                let server = match sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
                    .bind(&app.server_id)
                    .fetch_optional(&db)
                    .await
                {
                    Ok(Some(s)) => s,
                    _ => continue,
                };

                add_activity_log_impl(&db, &format!("[Auto-Deploy] '{}' layihəsi üçün registry imici yoxlanılır (İmic: {})...", app.name, reg_image), "info").await;

                let inspect_output = tokio::time::timeout(
                    tokio::time::Duration::from_secs(8),
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
                                    add_activity_log_impl(&db, &format!("[Auto-Deploy] '{}' layihəsinin ilkin imic imzası qeyd edildi: {}", app.name, remote_digest), "info").await;
                                }
                                Some(ref local_digest) if local_digest != &remote_digest => {
                                    println!("[AUTO-DEPLOY] Yeni registry image versiyası tapıldı ({} -> {}), layihə: {}", local_digest, remote_digest, app.name);
                                    add_activity_log_impl(&db, &format!("[Auto-Deploy] '{}' layihəsi üçün yeni registry imici tapıldı ({} -> {}). Avtomatik yenilənmə başladılır...", app.name, local_digest, remote_digest), "success").await;
                                    
                                    let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                                        .bind(&remote_digest)
                                        .bind(&app.id)
                                        .execute(&db)
                                        .await;

                                    if let Err(e) = trigger_deployment_impl(db.clone(), app.id.clone(), false).await {
                                        eprintln!("[AUTO-DEPLOY ERROR] Failed to trigger image deployment for {}: {}", app.name, e);
                                        add_activity_log_impl(&db, &format!("[Auto-Deploy Xətası] '{}' layihəsinin avtomatik yenilənməsi başlaya bilmədi: {}", app.name, e), "error").await;
                                    }
                                }
                                _ => {
                                    add_activity_log_impl(&db, &format!("[Auto-Deploy] '{}' yoxlanıldı. Yenilik yoxdur.", app.name), "info").await;
                                }
                            }
                        } else {
                            add_activity_log_impl(&db, &format!("[Auto-Deploy Xətası] '{}' üçün imic manifestindən digest oxuna bilmədi.", app.name), "error").await;
                        }
                    }
                    Ok(Ok(out)) => {
                        let err_str = String::from_utf8_lossy(&out.stderr);
                        add_activity_log_impl(&db, &format!("[Auto-Deploy Xətası] '{}' üçün manifest yoxlanışı xəta verdi: {}", app.name, err_str.trim()), "error").await;
                    }
                    Ok(Err(e)) => {
                        add_activity_log_impl(&db, &format!("[Auto-Deploy Xətası] '{}' üçün yoxlanış əmri icra edilə bilmədi: {}", app.name, e), "error").await;
                    }
                    Err(_) => {
                        add_activity_log_impl(&db, &format!("[Auto-Deploy Xətası] '{}' üçün manifest yoxlanışı vaxt aşımına uğradı (8s).", app.name), "error").await;
                    }
                }
                continue;
            }

            if app.repo_url.is_empty() || app.repo_url.starts_with("DOCKER_IMAGE:") {
                continue;
            }

            add_activity_log_impl(&db, &format!("[Auto-Deploy] '{}' layihəsi üçün yeni Git commit yoxlanılır (Budaq: {})...", app.name, app.branch), "info").await;

            let output = tokio::time::timeout(
                tokio::time::Duration::from_secs(15),
                tokio::process::Command::new("git")
                    .env("GIT_TERMINAL_PROMPT", "0")
                    .args(["ls-remote", &app.repo_url, &app.branch])
                    .output()
            ).await;

            match output {
                Ok(Ok(out)) if out.status.success() => {
                    let result_str = String::from_utf8_lossy(&out.stdout);
                    if let Some(remote_sha) = result_str.split_whitespace().next() {
                        let remote_sha = remote_sha.to_string();
                        
                        match app.last_commit_hash {
                            None => {
                                let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                                    .bind(&remote_sha)
                                    .bind(&app.id)
                                    .execute(&db)
                                    .await;
                                add_activity_log_impl(&db, &format!("[Auto-Deploy] '{}' layihəsinin ilkin Git commit imzası qeyd edildi: {}", app.name, remote_sha), "info").await;
                            }
                            Some(ref local_sha) if local_sha != &remote_sha => {
                                println!("[AUTO-DEPLOY] Yeni commit tapıldı ({} -> {}), layihə: {}", local_sha, remote_sha, app.name);
                                add_activity_log_impl(&db, &format!("[Auto-Deploy] '{}' layihəsi üçün yeni commit tapıldı ({} -> {}). Avtomatik yenilənmə başladılır...", app.name, local_sha, remote_sha), "success").await;
                                
                                let _ = sqlx::query("UPDATE applications SET last_commit_hash = ? WHERE id = ?")
                                    .bind(&remote_sha)
                                    .bind(&app.id)
                                    .execute(&db)
                                    .await;
 
                                if let Err(e) = trigger_deployment_impl(db.clone(), app.id.clone(), false).await {
                                    eprintln!("[AUTO-DEPLOY ERROR] Failed to trigger deployment for {}: {}", app.name, e);
                                    add_activity_log_impl(&db, &format!("[Auto-Deploy Xətası] '{}' layihəsinin avtomatik yenilənməsi başlaya bilmədi: {}", app.name, e), "error").await;
                                }
                            }
                            _ => {
                                add_activity_log_impl(&db, &format!("[Auto-Deploy] '{}' yoxlanıldı. Yenilik yoxdur.", app.name), "info").await;
                            }
                        }
                    }
                }
                Ok(Ok(out)) => {
                    let err_str = String::from_utf8_lossy(&out.stderr);
                    eprintln!("[AUTO-DEPLOY ERROR] git ls-remote failed for {}: {}", app.name, err_str.trim());
                    add_activity_log_impl(&db, &format!("[Auto-Deploy Xətası] '{}' üçün git ls-remote uğursuz oldu: {}", app.name, err_str.trim()), "error").await;
                }
                Ok(Err(e)) => {
                    eprintln!("[AUTO-DEPLOY ERROR] Failed to execute git command for {}: {}", app.name, e);
                    add_activity_log_impl(&db, &format!("[Auto-Deploy Xətası] '{}' üçün Git əmri icra edilə bilmədi: {}", app.name, e), "error").await;
                }
                Err(_) => {
                    eprintln!("[AUTO-DEPLOY ERROR] git ls-remote timed out (15s limit) for {}", app.name);
                    add_activity_log_impl(&db, &format!("[Auto-Deploy Xətası] '{}' üçün Git sorğusu vaxt aşımına uğradı (15s).", app.name), "error").await;
                }
            }
        }
    }
}

// Cloudflare functions moved to plugins/cloudflare.rs

async fn request_logger(
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    
    // Statik fayllar və çox tez-tez çağırılan stats/logs üçün loq yazılmasını dayandırırıq
    let is_noisy = path.contains("/stats") || path.contains("/logs");
    let is_api = path.starts_with("/api") && !is_noisy;
    
    let start = std::time::Instant::now();
    let response = next.run(req).await;
    let duration = start.elapsed();
    
    if is_api {
        println!(
            "[MD-LOGGER] {} {} -> {} ({:?})",
            method,
            path,
            response.status(),
            duration
        );
    }
    
    response
}

