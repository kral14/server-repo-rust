use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use uuid::Uuid;
use sqlx::SqlitePool;
use crate::models::{Application, Deployment, Server};
use crate::utils::add_activity_log_pro;
use crate::AppState;

pub fn deploy_router() -> Router<AppState> {
    Router::new()
        .route("/:app_id", post(trigger_deployment))
        .route("/cancel/:deploy_id", post(cancel_deployment))
}

pub fn deployments_router() -> Router<AppState> {
    Router::new()
        .route("/:app_id", get(list_deployments))
        .route("/single/:deploy_id", get(get_deployment))
}

#[derive(serde::Deserialize)]
pub struct DeployQuery {
    pub no_cache: Option<bool>,
}

pub async fn trigger_deployment(
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

pub async fn trigger_deployment_impl(
    db: SqlitePool,
    app_id: String,
    no_cache: bool,
) -> Result<Deployment, String> {
    let id = Uuid::new_v4().to_string();
    
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

    let _ = sqlx::query("UPDATE deployments SET status = 'cancelled' WHERE application_id = ? AND (status = 'building' || status = 'deploying')")
        .bind(&app_id)
        .execute(&db)
        .await;

    let deployment = Deployment {
        id: id.clone(),
        application_id: app_id.clone(),
        status: "building".to_string(),
        logs: "Starting deployment...\n".to_string(),
        created_at: String::new(),
    };

    if let Err(e) = sqlx::query(
        "INSERT INTO deployments (id, application_id, status, logs, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)"
    )
    .bind(&deployment.id)
    .bind(&deployment.application_id)
    .bind(&deployment.status)
    .bind(&deployment.logs)
    .execute(&db)
    .await {
        return Err(e.to_string());
    }

    if let Err(e) = sqlx::query("UPDATE applications SET status = 'deploying' WHERE id = ?")
        .bind(&app_id)
        .execute(&db)
        .await {
            return Err(e.to_string());
        }

    add_activity_log_pro(&db, &format!("Deploy başladıldı: '{}' (Server: {})", app.name, server.name), "info", Some("Deploy"), Some("admin"), Some(&app_id), None).await;

    let db_clone = db.clone();
    let deploy_id = id.clone();
    let app_id_clone = app_id.clone();
    
    tokio::spawn(async move {
        let logs = std::sync::Arc::new(tokio::sync::Mutex::new(format!("Connecting to server {} ({})...\n", server.name, server.ip)));
        {
            let lock = logs.lock().await;
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }

        let temp_key_path = std::env::temp_dir().join(format!("temp_key_{}.key", deploy_id)).to_string_lossy().into_owned();
        
        let key_content = if let Some(ref kid) = server.ssh_key_id {
            let db_key: Option<(String,)> = sqlx::query_as("SELECT private_key FROM ssh_keys WHERE id = ?")
                .bind(kid)
                .fetch_optional(&db_clone)
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
            let mut lock = logs.lock().await;
            lock.push_str(&format!("[FATAL ERROR] Failed to write temporary SSH key: {}\n", e));
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
            finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
            return;
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

        {
            let mut lock = logs.lock().await;
            lock.push_str(&format!("[0/5] Port toqquşması və Firewall icazəsi yoxlanılır (Port: {})...\n", app.port));
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }

        let port_check_cmd = if server.ip == "local" || server.ip == "127.0.0.1" {
            format!(
                "other_container=$(docker ps --filter \"publish={}\" --format \"{{{{.Names}}}}\" | grep -v \"^{}$\"); \
                 if [ ! -z \"$other_container\" ]; then \
                     echo \"===PORT_CONFLICT===\"; \
                 elif ! docker ps --filter \"name={}\" --format \"{{{{.Names}}}}\" | grep -q \"^{}$\"; then \
                     if docker run --rm -p {}:{} alpine:3.18 true 2>&1 | grep -q \"port is already allocated\"; then \
                         echo \"===PORT_CONFLICT===\"; \
                     else \
                         echo \"===PORT_OK===\"; \
                     fi; \
                 else \
                     echo \"===PORT_OK===\"; \
                 fi",
                app.port, app.name, app.name, app.name, app.port, app.port
            )
        } else {
            format!(
                "conflict_container=$(sudo docker ps --filter \"publish={}\" --format \"{{{{.Names}}}}\" | grep -v \"^{}$\"); \
                 if [ ! -z \"$conflict_container\" ]; then \
                     echo \"===PORT_CONFLICT===\"; \
                 elif sudo docker ps --filter \"name={}\" --format \"{{{{.Names}}}}\" | grep -q \"^{}$\"; then \
                     echo \"===PORT_OK===\"; \
                 elif sudo ss -tulpn | grep -q \":{} \"; then \
                     echo \"===PORT_CONFLICT===\"; \
                 elif sudo ufw status 2>/dev/null | grep -q \"Status: active\" && ! sudo ufw status | grep -q \"{}/tcp\"; then \
                     echo \"===FIREWALL_BLOCKED===\"; \
                 else \
                     echo \"===PORT_OK===\"; \
                 fi",
                app.port, app.name, app.name, app.name, app.port, app.port
            )
        };

        let mut port_ok = false;
        let mut err_msg = String::new();

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
            let reg_img = app.registry_image.clone().unwrap_or_default();
            {
                let mut lock = logs.lock().await;
                lock.push_str(&format!("[2/5] Registry imici uzaq serverə çəkilir (Image: {})...\n", reg_img));
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
            }

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
            {
                let mut lock = logs.lock().await;
                lock.push_str(&format!("[2/5] Git repository klonlanır (Branch: {})...\n", app.branch));
                update_logs_helper(&db_clone, &deploy_id, &lock).await;
            }
            
            let gh_token: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'github_token'")
                .fetch_optional(&db_clone)
                .await
                .unwrap_or_default();
            let token_str = gh_token.as_ref().map(|t| t.0.as_str());
            let repo_clone_url = crate::utils::format_github_repo_url(&app.repo_url, token_str);

            let git_cmd = format!(
                "if [ -d \"/data/masterdeploy/apps/{}\" ]; then cd /data/masterdeploy/apps/{} && git remote set-url origin {} && git fetch --all && git reset --hard origin/{}; else git clone -b {} {} /data/masterdeploy/apps/{}; fi",
                app.name, app.name, repo_clone_url, app.branch, app.branch, repo_clone_url, app.name
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

        {
            let mut lock = logs.lock().await;
            lock.push_str("[4/5] Köhnə konteynerlər təmizlənir...\n");
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }
        
        let mut old_image_id = String::new();
        let inspect_old_cmd = format!(
            "sudo docker inspect --format 'SHA: {{{{.Image}}}} | İmic: {{{{.Config.Image}}}} | Yaradılma: {{{{.Created}}}} | Başlama: {{{{.State.StartedAt}}}} | Digest: {{{{range .RepoDigests}}}}{{{{.}}}}{{{{end}}}}' {} 2>/dev/null || echo 'Tapılmadı'",
            app.name
        );
        let old_image_logs = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
        let _ = run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), inspect_old_cmd, db_clone.clone(), String::new(), old_image_logs.clone()).await;
        let old_image_info = old_image_logs.lock().await.trim().to_string();
        if !old_image_info.is_empty() && old_image_info != "Tapılmadı" {
            if old_image_info.contains("SHA: ") {
                if let Some(sha_part) = old_image_info.split('|').next() {
                    old_image_id = sha_part.replace("SHA: ", "").trim().to_string();
                }
            }
            let mut lock = logs.lock().await;
            lock.push_str(&format!("[INFO] Köhnə versiya məlumatı:\n  {}\n", old_image_info));
            update_logs_helper(&db_clone, &deploy_id, &lock).await;
        }

        let cleanup_cmd = format!(
            "sudo docker rm -f {} || true",
            app.name
        );
        
        let _ = run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), cleanup_cmd, db_clone.clone(), deploy_id.clone(), logs.clone()).await;

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
                let inspect_new_cmd = format!(
                    "sudo docker inspect --format 'SHA: {{{{.Image}}}} | Yaradılma: {{{{.Created}}}} | Başlama: {{{{.State.StartedAt}}}} | Digest: {{{{range .RepoDigests}}}}{{{{.}}}}{{{{end}}}}' {} 2>/dev/null || echo 'Tapılmadı'",
                    app.name
                );
                let new_image_logs = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
                let _ = run_ssh_cmd_stream_helper(temp_key_path.clone(), server.ssh_user.clone(), server.ip.clone(), inspect_new_cmd, db_clone.clone(), String::new(), new_image_logs.clone()).await;
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
                
                if !old_image_id.is_empty() && old_image_id != "Tapılmadı" {
                    lock.push_str(&format!("[ROLLBACK] Yeni versiya işə düşmədi. Əvvəlki işlək versiya (SHA: {}) yenidən aktivləşdirilir...\n", old_image_id));
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                    
                    let rollback_cmd = format!(
                        "sudo docker rm -f {} || true && sudo docker run -d --name {} --restart always -p {}:{} {} {}",
                        app.name, app.name, app.port, app.port, env_args, old_image_id
                    );
                    
                    let rollback_res = run_ssh_cmd_stream_helper(
                        temp_key_path.clone(),
                        server.ssh_user.clone(),
                        server.ip.clone(),
                        rollback_cmd,
                        db_clone.clone(),
                        deploy_id.clone(),
                        logs.clone(),
                    ).await;
                    
                    match rollback_res {
                        Ok(true) => {
                            let mut lock_rb = logs.lock().await;
                            lock_rb.push_str("[ROLLBACK SUCCESS] Uğursuz quraşdırmadan sonra əvvəlki işlək versiyaya geri qayıdış (rollback) tamamlandı! 🎉 Layihə aktiv qalacaq.\n");
                            update_logs_helper(&db_clone, &deploy_id, &lock_rb).await;
                            
                            finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
                            
                            let _ = sqlx::query("UPDATE applications SET status = 'running' WHERE id = ?")
                                .bind(&app_id_clone)
                                .execute(&db_clone)
                                .await;
                        }
                        _ => {
                            let mut lock_rb = logs.lock().await;
                            lock_rb.push_str("[ROLLBACK FAILED] Əvvəlki versiyaya geri qayıdış baş tutmadı! Tətbiq sönülü qaldı.\n");
                            update_logs_helper(&db_clone, &deploy_id, &lock_rb).await;
                            finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
                        }
                    }
                } else {
                    lock.push_str("[ROLLBACK] Əvvəlki işlək imic SHA-sı tapılmadığı üçün rollback edilə bilmədi.\n");
                    update_logs_helper(&db_clone, &deploy_id, &lock).await;
                    finalize_deploy(&db_clone, &deploy_id, &app_id_clone, "failed").await;
                }
            }
        }

        let _ = std::fs::remove_file(&temp_key_path);
    });

    Ok(deployment)
}

pub async fn cancel_deployment(State(state): State<AppState>, AxumPath(deploy_id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
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

    let app_name = sqlx::query_scalar::<_, String>("SELECT name FROM applications WHERE id = ?")
        .bind(&deployment.application_id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or_default()
        .unwrap_or_else(|| "Naməlum".to_string());
    add_activity_log_pro(&state.db, &format!("Yayım dayandırıldı (ləğv edildi): '{}'", app_name), "warning", Some("Deploy"), Some("admin"), Some(&deployment.application_id), None).await;

    Ok(Json(true))
}

pub async fn list_deployments(State(state): State<AppState>, AxumPath(app_id): AxumPath<String>) -> Result<Json<Vec<Deployment>>, (StatusCode, String)> {
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

pub async fn get_deployment(State(state): State<AppState>, AxumPath(deploy_id): AxumPath<String>) -> Result<Json<Deployment>, (StatusCode, String)> {
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

pub async fn update_logs_helper(db: &SqlitePool, dep_id: &str, text: &str) {
    let _ = sqlx::query("UPDATE deployments SET logs = ? WHERE id = ?")
        .bind(text)
        .bind(dep_id)
        .execute(db)
        .await;
}

pub async fn finalize_deploy(db: &SqlitePool, deploy_id: &str, app_id: &str, status: &str) {
    let _ = sqlx::query("UPDATE deployments SET status = ? WHERE id = ?")
        .bind(status)
        .bind(deploy_id)
        .execute(db)
        .await;

    if status == "success" {
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

    if let Ok(Some(app)) = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?").bind(app_id).fetch_optional(db).await {
        if status == "success" {
            add_activity_log_pro(db, &format!("Deploy uğurla tamamlandı: '{}' (Port: {})", app.name, app.port), "success", Some("Deploy"), Some("System"), Some(app_id), None).await;
            
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
        } else if status == "failed" {
            add_activity_log_pro(db, &format!("Deploy xətası: '{}' qurulumu uğursuz oldu", app.name), "error", Some("Deploy"), Some("System"), Some(app_id), None).await;
        }
    }
}

pub async fn run_ssh_cmd_stream_helper(
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

    loop {
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
                        if !deploy_id_clone.is_empty() {
                            update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            line = stderr_reader.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        let mut lock = logs_clone.lock().await;
                        lock.push_str(&format!("{}\n", l));
                        if !deploy_id_clone.is_empty() {
                            update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            status = child.wait() => {
                let exit_status = status?;
                while let Ok(Some(l)) = stdout_reader.next_line().await {
                    let mut lock = logs_clone.lock().await;
                    lock.push_str(&format!("{}\n", l));
                    if !deploy_id_clone.is_empty() {
                        update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                    }
                }
                while let Ok(Some(l)) = stderr_reader.next_line().await {
                    let mut lock = logs_clone.lock().await;
                    lock.push_str(&format!("{}\n", l));
                    if !deploy_id_clone.is_empty() {
                        update_logs_helper(&db_clone, &deploy_id_clone, &lock).await;
                    }
                }
                return Ok(exit_status.success());
            }
        }
    }

    let exit_status = child.wait().await?;
    Ok(exit_status.success())
}
