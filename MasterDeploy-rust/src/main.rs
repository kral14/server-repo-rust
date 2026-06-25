use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    routing::{get, post, delete},
    Json, Router,
};
use sqlx::SqlitePool;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use uuid::Uuid;

mod db;
mod models;

use models::{Application, CreateApplicationInput, CreateServerInput, Deployment, Server};

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
}

#[tokio::main]
async fn main() {
    let pool = db::init_db().await.expect("Failed to initialize database");
    let state = AppState { db: pool };

    let app = Router::new()
        .nest_service("/", ServeDir::new("static"))
        .route("/api/servers", get(list_servers).post(create_server))
        .route("/api/servers/:server_id", get(get_server).delete(delete_server))
        .route("/api/servers/:server_id/stats", get(get_server_stats))
        .route("/api/servers/:server_id/setup", post(setup_server))
        .route("/api/applications", get(list_applications).post(create_application))
        .route("/api/applications/:app_id", get(get_application).put(update_application).delete(delete_application))
        .route("/api/deploy/:app_id", post(trigger_deployment))
        .route("/api/deploy/cancel/:deploy_id", post(cancel_deployment))
        .route("/api/deployments/:app_id", get(list_deployments))
        .route("/api/runtime-logs/:app_id", get(get_runtime_logs))
        .route("/api/version", get(get_version))
        .layer(CorsLayer::permissive())
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

async fn delete_server(State(state): State<AppState>, AxumPath(server_id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query("DELETE FROM servers WHERE id = ?").bind(&server_id).execute(&state.db).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
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

    let cmd = "free -m | awk 'NR==2{print $2,$3}'; nproc";
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
                    "-i", &temp_key_path,
                    &format!("{}@{}", server.ssh_user, server.ip),
                    cmd
                ])
                .output()
                .await
        }
    } {
        Ok(out) => out,
        Err(_) => {
            let _ = std::fs::remove_file(&temp_key_path);
            return Ok(Json(serde_json::json!({"total_ram_mb": 0, "used_ram_mb": 0, "cores": 0})));
        }
    };

    let _ = std::fs::remove_file(&temp_key_path);

    if !output.status.success() {
        return Ok(Json(serde_json::json!({"total_ram_mb": 0, "used_ram_mb": 0, "cores": 0})));
    }

    let result_str = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = result_str.trim().split_whitespace().collect();
    
    if parts.len() == 3 {
        let stats = serde_json::json!({
            "total_ram_mb": parts[0].parse::<u64>().unwrap_or(0),
            "used_ram_mb": parts[1].parse::<u64>().unwrap_or(0),
            "cores": parts[2].parse::<u64>().unwrap_or(1)
        });
        Ok(Json(stats))
    } else {
        Ok(Json(serde_json::json!({"total_ram_mb": 0, "used_ram_mb": 0, "cores": 0})))
    }
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
    let apps = sqlx::query_as::<_, Application>("SELECT * FROM applications ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(apps))
}

async fn create_application(State(state): State<AppState>, Json(input): Json<CreateApplicationInput>) -> Result<(StatusCode, Json<Application>), (StatusCode, String)> {
    let id = Uuid::new_v4().to_string();
    let bp_type = input.build_pack_type.clone().unwrap_or_else(|| "dockerfile".to_string());
    
    sqlx::query(
        "INSERT INTO applications (
            id, name, repo_url, branch, port, server_id, status, env_vars,
            build_pack_type, build_command, run_command, dockerfile_path,
            entrypoint, command, target, work_dir, privileged, memory_limit, cpu_limit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        created_at: String::new(),
        updated_at: String::new(),
    };
    
    Ok((StatusCode::CREATED, Json(app)))
}

async fn get_application(State(state): State<AppState>, AxumPath(app_id): AxumPath<String>) -> Result<Json<Application>, (StatusCode, String)> {
    let app = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
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
            command = ?, target = ?, work_dir = ?, privileged = ?, memory_limit = ?, cpu_limit = ?
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
    .bind(&app_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(true))
}

async fn delete_application(State(state): State<AppState>, AxumPath(app_id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query("DELETE FROM applications WHERE id = ?").bind(&app_id).execute(&state.db).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
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

    let app_status = if status == "success" { "running" } else { "failed" };
    let _ = sqlx::query("UPDATE applications SET status = ? WHERE id = ?")
        .bind(app_status)
        .bind(app_id)
        .execute(db)
        .await;
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
        tokio::process::Command::new("ssh")
            .args(&[
                "-o", "StrictHostKeyChecking=no",
                "-o", "ConnectTimeout=15",
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
        tokio::select! {
            line = stdout_reader.next_line() => {
                if let Ok(Some(l)) = line {
                    let mut lock = logs_clone.lock().await;
                    lock.push_str(&format!("{}\n", l));
                    update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                } else if line.is_err() {
                    break;
                }
            }
            line = stderr_reader.next_line() => {
                if let Ok(Some(l)) = line {
                    let mut lock = logs_clone.lock().await;
                    lock.push_str(&format!("{}\n", l));
                    update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                } else if line.is_err() {
                    break;
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

async fn trigger_deployment(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<Deployment>, (StatusCode, String)> {
    let id = Uuid::new_v4().to_string();
    
    // Fetch application details to get server connection info
    let app = match sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
        .bind(&app_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(a)) => a,
        Ok(None) => return Err((StatusCode::NOT_FOUND, "Application not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    let server = match sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&app.server_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(s)) => s,
        Ok(None) => return Err((StatusCode::NOT_FOUND, "Target server not found".to_string())),
        Err(e) => return Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    // Create new deployment record
    let deployment = Deployment {
        id: id.clone(),
        application_id: app_id.clone(),
        status: "building".to_string(),
        logs: "Starting deployment...\n".to_string(),
        created_at: String::new(),
    };

    sqlx::query(
        "INSERT INTO deployments (id, application_id, status, logs) VALUES (?, ?, ?, ?)"
    )
    .bind(&deployment.id)
    .bind(&deployment.application_id)
    .bind(&deployment.status)
    .bind(&deployment.logs)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Update application status
    sqlx::query("UPDATE applications SET status = 'deploying' WHERE id = ?")
        .bind(&app_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Spawn background task to perform actual SSH commands
    let db_clone = state.db.clone();
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
                     echo -e \"FROM rust:1-slim AS builder\\nRUN apt-get update && apt-get install -y pkg-config libssl-dev\\nWORKDIR /app\\nCOPY . .\\nRUN $BUILD_CMD\\nFROM debian:bookworm-slim\\nRUN apt-get update && apt-get install -y libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*\\nWORKDIR /app\\nCOPY --from=builder /app/$RUN_CMD ./app_bin\\nEXPOSE {}\\nCMD [\\\"./app_bin\\\"]\" > Dockerfile; \
                 else \
                     echo 'Fallback static/generic server.'; \
                     echo -e \"FROM alpine:latest\\nRUN apk add --no-cache curl\\nCMD [\\\"sleep\\\", \\\"3600\\\"]\" > Dockerfile; \
                 fi && sudo docker build -t {}:latest .",
                app.name, 
                bc, rc, app.port,
                bc, rc, app.port,
                bc, rc, app.port,
                bc, rc, app.port,
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
            
            format!(
                "cd /data/masterdeploy/apps/{} && ( [ -f \"{}\" ] || echo -e 'FROM alpine\\nRUN apk add --no-cache curl\\nCMD [\"sleep\", \"3600\"]' > \"{}\" ) && sudo docker build {} -f \"{}\" -t {}:latest .",
                app.name, df_file, df_file, target_arg, df_file, app.name
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

        // Step 4: Stop and Remove Old Container (if exists)
        {
            let mut lock = logs.lock().await;
            lock.push_str("[4/5] Köhnə konteynerlər təmizlənir...\n");
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }
        
        let cleanup_cmd = format!(
            "sudo docker stop {} || true && sudo docker rm {} || true",
            app.name, app.name
        );
        
        let _ = run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), cleanup_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await;

        // Step 5: Start New Docker Container
        {
            let mut lock = logs.lock().await;
            lock.push_str(&format!("[5/5] Yeni konteyner işə salınır (Port: {})... \n", app.port));
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }
        
        let mut env_args = String::new();
        if let Some(ref env_vars_str) = app.env_vars {
            for line in env_vars_str.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if trimmed.contains('=') {
                    // Tək dırnaqlardan istifadə edirik ki, bash/sh $ kimi xüsusi simvolları dəyişən kimi oxumasın
                    let escaped = trimmed.replace("'", "'\\''");
                    env_args.push_str(&format!(" -e '{}'", escaped));
                }
            }
        }
        
        let run_cmd = format!(
            "sudo docker run -d --name {} --restart always -p {}:{}{} {}:latest",
            app.name, app.port, app.port, env_args, app.name
        );
        
        match run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), run_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await {
            Ok(true) => {
                let mut lock = logs.lock().await;
                lock.push_str("[SUCCESS] Tətbiq uğurla deploy olundu! 🎉\n");
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
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

    Ok(Json(deployment))
}
