use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use uuid::Uuid;
use crate::models::{CreateServerInput, UpdateServerInput, Server, SshKey, CreateSshKeyInput};
use crate::utils::add_activity_log_pro;
use crate::ssh;
use crate::AppState;

pub fn servers_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_servers).post(create_server))
        .route("/:server_id", get(get_server).put(update_server).delete(delete_server))
        .route("/:server_id/stats", get(get_server_stats))
        .route("/:server_id/setup", post(setup_server))
        .route("/:server_id/check", get(check_server_connection))
        .route("/:server_id/volumes", get(list_server_volumes))
        .route("/:server_id/volumes/:volume_name", post(delete_server_volume))
}

pub fn ssh_keys_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_ssh_keys).post(create_ssh_key))
        .route("/:key_id", put(update_ssh_key).delete(delete_ssh_key))
        .route("/generate-rsa", post(generate_rsa_keypair))
}

pub async fn list_servers(State(state): State<AppState>) -> Result<Json<Vec<Server>>, (StatusCode, String)> {
    let servers = sqlx::query_as::<_, Server>("SELECT * FROM servers ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(servers))
}

pub async fn create_server(State(state): State<AppState>, Json(input): Json<CreateServerInput>) -> Result<(StatusCode, Json<Server>), (StatusCode, String)> {
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM servers WHERE ip = ?")
        .bind(&input.ip)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        
    if exists.is_some() {
        return Err((StatusCode::BAD_REQUEST, "Bu IP ünvanına malik server artıq mövcuddur!".to_string()));
    }

    let id = Uuid::new_v4().to_string();
    let ssh_key_content = if let Some(ref key_id) = input.ssh_key_id {
        if key_id.trim().is_empty() {
            input.ssh_key.clone()
        } else {
            let key_row: Option<(String,)> = sqlx::query_as("SELECT private_key FROM ssh_keys WHERE id = ?")
                .bind(key_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            key_row.map(|(k,)| k).unwrap_or(input.ssh_key.clone())
        }
    } else {
        input.ssh_key.clone()
    };

    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key, ssh_key_id) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(&input.name)
        .bind(&input.ip)
        .bind(&input.ssh_user)
        .bind(&ssh_key_content)
        .bind(&input.ssh_key_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let server = Server {
        id,
        name: input.name,
        ip: input.ip,
        ssh_user: input.ssh_user,
        ssh_key: input.ssh_key,
        ssh_key_id: input.ssh_key_id,
        created_at: String::new(),
        updated_at: String::new(),
    };
    Ok((StatusCode::CREATED, Json(server)))
}

pub async fn get_server(State(state): State<AppState>, AxumPath(server_id): AxumPath<String>) -> Result<Json<Server>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;
    Ok(Json(server))
}

pub async fn update_server(
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

    let ssh_key_content = if let Some(ref key_id) = input.ssh_key_id {
        if key_id.trim().is_empty() {
            input.ssh_key.clone()
        } else {
            let key_row: Option<(String,)> = sqlx::query_as("SELECT private_key FROM ssh_keys WHERE id = ?")
                .bind(key_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            key_row.map(|(k,)| k).unwrap_or(input.ssh_key.clone())
        }
    } else {
        input.ssh_key.clone()
    };

    sqlx::query("UPDATE servers SET name = ?, ip = ?, ssh_user = ?, ssh_key = ?, ssh_key_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&input.name)
        .bind(&input.ip)
        .bind(&input.ssh_user)
        .bind(&ssh_key_content)
        .bind(&input.ssh_key_id)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateSshKeyInput {
    pub name: String,
    pub description: Option<String>,
}

pub async fn update_ssh_key(
    State(state): State<AppState>,
    AxumPath(key_id): AxumPath<String>,
    Json(input): Json<UpdateSshKeyInput>,
) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query("UPDATE ssh_keys SET name = ?, description = ? WHERE id = ?")
        .bind(&input.name)
        .bind(&input.description)
        .bind(&key_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

pub async fn list_ssh_keys(State(state): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    #[derive(serde::Serialize, sqlx::FromRow)]
    struct SshKeyWithServers {
        id: String,
        name: String,
        description: Option<String>,
        private_key: String,
        created_at: String,
        used_servers: Option<String>,
    }

    let keys = sqlx::query_as::<_, SshKeyWithServers>(
        "SELECT k.id, k.name, k.description, k.private_key, CAST(k.created_at AS TEXT) as created_at, \
         (SELECT GROUP_CONCAT(s.name || ' (' || s.ip || ')', ', ') FROM servers s WHERE s.ssh_key_id = k.id) as used_servers \
         FROM ssh_keys k ORDER BY k.created_at DESC"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::to_value(keys).unwrap()))
}

pub async fn create_ssh_key(
    State(state): State<AppState>,
    Json(input): Json<CreateSshKeyInput>,
) -> Result<(StatusCode, Json<SshKey>), (StatusCode, String)> {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO ssh_keys (id, name, description, private_key) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&input.name)
        .bind(&input.description)
        .bind(&input.private_key)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let key = SshKey {
        id,
        name: input.name,
        description: input.description,
        private_key: String::new(),
        created_at: String::new(),
    };

    Ok((StatusCode::CREATED, Json(key)))
}

pub async fn delete_ssh_key(
    State(state): State<AppState>,
    AxumPath(key_id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let in_use: Option<(String, String)> = sqlx::query_as("SELECT name, ip FROM servers WHERE ssh_key_id = ? LIMIT 1")
        .bind(&key_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some((server_name, server_ip)) = in_use {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Bu açar silinə bilməz, çünki '{}' ({}) serveri tərəfindən istifadə olunur!", server_name, server_ip)
        ));
    }

    sqlx::query("DELETE FROM ssh_keys WHERE id = ?")
        .bind(&key_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(true))
}

pub async fn delete_server(State(state): State<AppState>, AxumPath(server_id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
    let mut tx = state.db.begin().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("DELETE FROM deployments WHERE application_id IN (SELECT id FROM applications WHERE server_id = ?)")
        .bind(&server_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("DELETE FROM applications WHERE server_id = ?")
        .bind(&server_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let server_name = sqlx::query_scalar::<_, String>("SELECT name FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or_default()
        .unwrap_or_else(|| "Naməlum".to_string());

    sqlx::query("DELETE FROM servers WHERE id = ?")
        .bind(&server_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tx.commit().await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    add_activity_log_pro(&state.db, &format!("Server silindi: '{}'", server_name), "warning", Some("Servers"), Some("admin"), Some(&server_id), None).await;
    Ok(Json(true))
}

pub async fn get_server_stats(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = match sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
    {
        Ok(Some(s)) => s,
        _ => {
            return Ok(Json(serde_json::json!({
                "total_ram_mb": 0, "used_ram_mb": 0, "ram_percent": 0,
                "total_swap_mb": 0, "used_swap_mb": 0, "swap_percent": 0,
                "cores": 0, "cpu_percent": 0,
                "disk_total": "--", "disk_used": "--", "disk_free": "--", "disk_percent": 0,
                "containers": {}
            })));
        }
    };

    let temp_key_path = std::env::temp_dir().join(format!("temp_stats_key_{}.key", uuid::Uuid::new_v4())).to_string_lossy().into_owned();
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
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

    let cmd = "free -m | awk '/Mem:/{print $2,$3} /Swap:/{print $2,$3}'; nproc; df -h / | awk 'NR==2{print $2,$3,$4,$5}'; top -bn1 2>/dev/null | grep 'Cpu(s)' | awk '{print $2+$4}' || echo '0'; echo '---'; sudo docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' 2>/dev/null || true";
    
    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };
    
    let run_future = async {
        if server.ip == "local" || server.ip == "127.0.0.1" {
            let local_cmd = cmd.replace("sudo ", "");
            tokio::process::Command::new("sh")
                .arg("-c")
                .arg(&local_cmd)
                .output()
                .await
        } else {
            for attempt in 0..2 {
                let res = tokio::process::Command::new(ssh_bin)
                    .args(&[
                        "-o", "StrictHostKeyChecking=no",
                        "-o", "UserKnownHostsFile=/dev/null",
                        "-o", "BatchMode=yes",
                        "-o", "ConnectTimeout=5",
                        "-o", "ServerAliveInterval=2",
                        "-o", "ServerAliveCountMax=2",
                        "-i", &temp_key_path,
                        &format!("{}@{}", server.ssh_user, server.ip),
                        cmd
                    ])
                    .output()
                    .await;
                
                if let Ok(ref out) = res {
                    if out.status.success() {
                        return Ok(out.clone());
                    }
                }
                if attempt == 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                }
            }
            tokio::process::Command::new(ssh_bin)
                .args(&[
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "UserKnownHostsFile=/dev/null",
                    "-o", "BatchMode=yes",
                    "-o", "ConnectTimeout=5",
                    "-i", &temp_key_path,
                    &format!("{}@{}", server.ssh_user, server.ip),
                    cmd
                ])
                .output()
                .await
        }
    };

    let output_res = tokio::time::timeout(std::time::Duration::from_millis(6000), run_future).await;
    let _ = std::fs::remove_file(&temp_key_path);

    let output = match output_res {
        Ok(Ok(out)) => out,
        _ => {
            return Ok(Json(serde_json::json!({
                "total_ram_mb": 0, "used_ram_mb": 0, "ram_percent": 0,
                "total_swap_mb": 0, "used_swap_mb": 0, "swap_percent": 0,
                "cores": 0, "cpu_percent": 0,
                "disk_total": "--", "disk_used": "--", "disk_free": "--", "disk_percent": 0,
                "containers": {}
            })));
        }
    };

    if !output.status.success() {
        return Ok(Json(serde_json::json!({
            "total_ram_mb": 0, "used_ram_mb": 0, "ram_percent": 0,
            "total_swap_mb": 0, "used_swap_mb": 0, "swap_percent": 0,
            "cores": 0, "cpu_percent": 0,
            "disk_total": "--", "disk_used": "--", "disk_free": "--", "disk_percent": 0,
            "containers": {}
        })));
    }

    let result_str = String::from_utf8_lossy(&output.stdout);
    let sections: Vec<&str> = result_str.split("---").collect();

    let mut total_ram_mb: u64 = 0;
    let mut used_ram_mb: u64 = 0;
    let mut ram_percent: f64 = 0.0;

    let mut total_swap_mb: u64 = 0;
    let mut used_swap_mb: u64 = 0;
    let mut swap_percent: f64 = 0.0;

    let mut cores: u64 = 1;
    let mut cpu_percent: f64 = 0.0;

    let mut disk_total = String::from("--");
    let mut disk_used = String::from("--");
    let mut disk_free = String::from("--");
    let mut disk_percent: f64 = 0.0;

    let mut containers = serde_json::json!({});

    if let Some(sys_section) = sections.get(0) {
        let lines: Vec<&str> = sys_section.trim().lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
        
        if let Some(mem_line) = lines.get(0) {
            let parts: Vec<&str> = mem_line.split_whitespace().collect();
            if parts.len() >= 2 {
                total_ram_mb = parts[0].parse::<u64>().unwrap_or(0);
                used_ram_mb = parts[1].parse::<u64>().unwrap_or(0);
                if total_ram_mb > 0 {
                    ram_percent = ((used_ram_mb as f64) / (total_ram_mb as f64) * 100.0).round();
                }
            }
        }

        if let Some(swap_line) = lines.get(1) {
            let parts: Vec<&str> = swap_line.split_whitespace().collect();
            if parts.len() >= 2 {
                total_swap_mb = parts[0].parse::<u64>().unwrap_or(0);
                used_swap_mb = parts[1].parse::<u64>().unwrap_or(0);
                if total_swap_mb > 0 {
                    swap_percent = ((used_swap_mb as f64) / (total_swap_mb as f64) * 100.0).round();
                }
            }
        }

        if let Some(cores_line) = lines.get(2) {
            cores = cores_line.parse::<u64>().unwrap_or(1);
        }

        if let Some(df_line) = lines.get(3) {
            let parts: Vec<&str> = df_line.split_whitespace().collect();
            if parts.len() >= 4 {
                disk_total = parts[0].to_string();
                disk_used = parts[1].to_string();
                disk_free = parts[2].to_string();
                let pct_str = parts[3].trim_end_matches('%');
                disk_percent = pct_str.parse::<f64>().unwrap_or(0.0);
            }
        }

        if let Some(cpu_line) = lines.get(4) {
            cpu_percent = cpu_line.parse::<f64>().unwrap_or(0.0);
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
        "ram_percent": ram_percent,
        "total_swap_mb": total_swap_mb,
        "used_swap_mb": used_swap_mb,
        "swap_percent": swap_percent,
        "cores": cores,
        "cpu_percent": cpu_percent,
        "disk_total": disk_total,
        "disk_used": disk_used,
        "disk_free": disk_free,
        "disk_percent": disk_percent,
        "containers": containers
    });
    Ok(Json(stats))
}

pub async fn check_server_connection(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = std::env::temp_dir().join(format!("temp_check_key_{}.key", uuid::Uuid::new_v4())).to_string_lossy().into_owned();
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    let normalized_key = key_content.replace("\r\n", "\n").replace('\r', "\n").trim().to_string() + "\n";
    if let Err(e) = std::fs::write(&temp_key_path, &normalized_key) {
        return Ok(Json(serde_json::json!({
            "success": false,
            "error": format!("Key write error: {}", e)
        })));
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

    let _ = std::fs::remove_file(&temp_key_path);

    let result = match output {
        Ok(out) if out.status.success() => {
            Ok(Json(serde_json::json!({
                "success": true,
                "message": "Connection successful!"
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

    result
}

pub async fn list_server_volumes(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = std::env::temp_dir().join(format!("temp_vols_key_{}.key", uuid::Uuid::new_v4())).to_string_lossy().into_owned();
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
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

pub async fn delete_server_volume(
    State(state): State<AppState>,
    AxumPath((server_id, volume_name)): AxumPath<(String, String)>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = std::env::temp_dir().join(format!("temp_delvol_key_{}.key", uuid::Uuid::new_v4())).to_string_lossy().into_owned();
    let key_content = if server.ssh_key.contains("BEGIN ") {
        server.ssh_key.clone()
    } else {
        std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
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

pub async fn generate_rsa_keypair() -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let (private_key, public_key) = ssh::generate_rsa_keypair_content()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::json!({
        "private_key": private_key,
        "public_key": public_key
    })))
}

pub async fn setup_server(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server not found".to_string()))?;

    let temp_key_path = std::env::temp_dir().join(format!("temp_setup_key_{}.key", uuid::Uuid::new_v4())).to_string_lossy().into_owned();
    
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
