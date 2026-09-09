use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    routing::{get, post, delete},
    Json, Router,
};
use uuid::Uuid;
use crate::AppState;
use crate::models::{
    Server, Application, Tunnel, CreateTunnelInput,
    TunnelRoute, AttachTunnelRouteInput, TunnelWithDetails, TunnelRouteDetail
};


pub fn tunnels_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_all_tunnels).post(create_tunnel_direct))
        .route("/history", get(list_all_tunnel_history))
        .route("/history/:app_id", get(list_app_tunnel_history))
        .route("/server/:server_id", get(list_server_tunnels).post(create_tunnel))
        .route("/server/:server_id/sync-remote", post(sync_server_tunnels_to_remote))
        .route("/:tunnel_id", get(get_tunnel).delete(delete_tunnel))
        .route("/:tunnel_id/attach", post(attach_route))
        .route("/:tunnel_id/routes/:route_id", delete(detach_route))
        .route("/:tunnel_id/routes", get(list_tunnel_routes))
        .route("/:tunnel_id/sync-remote", post(sync_tunnel_to_remote))
}

async fn populate_tunnel_details(pool: &sqlx::SqlitePool, tunnels: Vec<Tunnel>) -> Vec<TunnelWithDetails> {
    let mut results = Vec::new();
    for t in tunnels {
        let (server_name, server_ip) = match sqlx::query_as::<_, (String, String)>(
            "SELECT name, ip FROM servers WHERE id = ?"
        ).bind(&t.server_id).fetch_optional(pool).await {
            Ok(Some((name, ip))) => (name, ip),
            _ => ("Bilinməyən Server".to_string(), "-".to_string()),
        };

        let routes_raw = sqlx::query_as::<_, (String, String, i64, String)>(
            "SELECT tr.id, tr.app_id, tr.target_port, tr.route_path \
             FROM tunnel_routes tr WHERE tr.tunnel_id = ?"
        ).bind(&t.id).fetch_all(pool).await.unwrap_or_default();

        let mut routes = Vec::new();
        for (r_id, a_id, port, r_path) in routes_raw {
            let (app_name, cloudflare_url, cf_worker_url): (String, Option<String>, Option<String>) = match sqlx::query_as(
                "SELECT name, cloudflare_url, cf_worker_url FROM applications WHERE id = ?"
            )
            .bind(&a_id)
            .fetch_optional(pool)
            .await {
                Ok(Some((name, cf_url, worker_url))) => (name, cf_url, worker_url),
                _ => ("Tətbiq".to_string(), None, None),
            };

            routes.push(TunnelRouteDetail {
                route_id: r_id,
                app_id: a_id,
                app_name,
                target_port: port,
                route_path: r_path,
                cloudflare_url,
                cf_worker_url,
            });
        }

        results.push(TunnelWithDetails {
            id: t.id,
            server_id: t.server_id,
            server_name,
            server_ip,
            name: t.name,
            tunnel_type: t.tunnel_type,
            public_url: t.public_url,
            status: t.status,
            last_error: t.last_error,
            created_at: t.created_at,
            updated_at: t.updated_at,
            routes,
        });
    }
    results
}

// 1. Bütün tünelləri gətir
async fn list_all_tunnels(State(state): State<AppState>) -> Result<Json<Vec<TunnelWithDetails>>, (StatusCode, String)> {
    let tunnels = sqlx::query_as::<_, Tunnel>("SELECT * FROM tunnels ORDER BY created_at DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let details = populate_tunnel_details(&state.db, tunnels).await;
    Ok(Json(details))
}

// 2. Müəyyən bir serverə (VM-ə) aid tünelləri gətir
async fn list_server_tunnels(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<Vec<TunnelWithDetails>>, (StatusCode, String)> {
    let tunnels = sqlx::query_as::<_, Tunnel>("SELECT * FROM tunnels WHERE server_id = ? ORDER BY created_at ASC")
        .bind(&server_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let details = populate_tunnel_details(&state.db, tunnels).await;
    Ok(Json(details))
}

async fn create_tunnel_direct(
    State(state): State<AppState>,
    Json(payload): Json<CreateTunnelInput>,
) -> Result<Json<Tunnel>, (StatusCode, String)> {
    let server_id = payload.server_id.clone().ok_or((StatusCode::BAD_REQUEST, "server_id sahəsi mütləqdir".to_string()))?;
    create_tunnel(State(state), AxumPath(server_id), Json(payload)).await
}

// 3. Tək bir tünelin detallarını gətir
async fn get_tunnel(
    State(state): State<AppState>,
    AxumPath(tunnel_id): AxumPath<String>,
) -> Result<Json<Tunnel>, (StatusCode, String)> {
    let tunnel = sqlx::query_as::<_, Tunnel>("SELECT * FROM tunnels WHERE id = ?")
        .bind(&tunnel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Tünel tapılmadı".to_string()))?;
    Ok(Json(tunnel))
}

// 4. Yeni tünel yarat (məsələn: 'Tunel-A' və ya 'Tunel-B')
async fn create_tunnel(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
    Json(payload): Json<CreateTunnelInput>,
) -> Result<Json<Tunnel>, (StatusCode, String)> {
    let tunnel_id = Uuid::new_v4().to_string();
    let tunnel_type = payload.tunnel_type.unwrap_or_else(|| "dedicated".to_string());

    sqlx::query(
        "INSERT INTO tunnels (id, server_id, name, tunnel_type, status) VALUES (?, ?, ?, ?, 'stopped')"
    )
    .bind(&tunnel_id)
    .bind(&server_id)
    .bind(&payload.name)
    .bind(&tunnel_type)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::BAD_REQUEST, format!("Tünel yaradıla bilmədi (ad təkrarlana bilməz): {}", e)))?;

    let created = sqlx::query_as::<_, Tunnel>("SELECT * FROM tunnels WHERE id = ?")
        .bind(&tunnel_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(created))
}

// 5. Tüneli sil
async fn delete_tunnel(
    State(state): State<AppState>,
    AxumPath(tunnel_id): AxumPath<String>,
) -> Result<Json<bool>, (StatusCode, String)> {
    // 1. Tünelə bağlı olan bütün layihələrin tunnel_id və cloudflare_url-ni təmizləyirik
    let _ = sqlx::query("UPDATE applications SET tunnel_id = NULL, cloudflare_url = NULL WHERE tunnel_id = ?")
        .bind(&tunnel_id)
        .execute(&state.db)
        .await;

    // 2. Marşrutları silirik
    let _ = sqlx::query("DELETE FROM tunnel_routes WHERE tunnel_id = ?")
        .bind(&tunnel_id)
        .execute(&state.db)
        .await;

    // 3. Tüneli silirik
    sqlx::query("DELETE FROM tunnels WHERE id = ?")
        .bind(&tunnel_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

// 6. Mövcud tünelə layihə marşrutu bağla (Attach Route)
async fn attach_route(
    State(state): State<AppState>,
    AxumPath(tunnel_id): AxumPath<String>,
    Json(payload): Json<AttachTunnelRouteInput>,
) -> Result<Json<TunnelRoute>, (StatusCode, String)> {
    let route_id = Uuid::new_v4().to_string();
    let route_path = payload.route_path.unwrap_or_else(|| "/".to_string());

    // Əgər artıq bağlıdırsa, portunu və yolunu yeniləyirik
    sqlx::query(
        "INSERT INTO tunnel_routes (id, tunnel_id, app_id, target_port, route_path) \
         VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(tunnel_id, app_id) DO UPDATE SET target_port = excluded.target_port, route_path = excluded.route_path"
    )
    .bind(&route_id)
    .bind(&tunnel_id)
    .bind(&payload.app_id)
    .bind(payload.target_port)
    .bind(&route_path)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::BAD_REQUEST, format!("Marşrut əlavə edilə bilmədi: {}", e)))?;

    // Layihənin tunnel_id-sini qeyd edirik.
    // DİQQƏT: Hər layihənin öz daxili portu (məs: 8080, 8081) var və eyni tünelə qoşulduqda 
    // başqa layihənin linki ilə əzilməməlidir (overwrite edilməməlidir) ki, toqquşma olmasın.
    let _ = sqlx::query("UPDATE applications SET tunnel_id = ? WHERE id = ?")
        .bind(&tunnel_id)
        .bind(&payload.app_id)
        .execute(&state.db)
        .await;

    // Əgər layihənin artıq öz canlı cloudflare_url-i yoxdursa, avtomatik olaraq bu tətbiqin portu üçün tüneli işə salırıq
    let app_current_url: Option<String> = sqlx::query_scalar(
        "SELECT cloudflare_url FROM applications WHERE id = ?"
    )
    .bind(&payload.app_id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or_default()
    .flatten();

    if app_current_url.is_none() || app_current_url.as_deref().unwrap_or("").is_empty() {
        let state_clone = state.clone();
        let app_id_clone = payload.app_id.clone();
        tokio::spawn(async move {
            let _ = crate::plugins::cloudflare::start_cloudflare_tunnel(
                axum::extract::State(state_clone),
                axum::extract::Path(app_id_clone),
            ).await;
        });
    }

    let route = sqlx::query_as::<_, TunnelRoute>("SELECT * FROM tunnel_routes WHERE tunnel_id = ? AND app_id = ?")
        .bind(&tunnel_id)
        .bind(&payload.app_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(route))
}

// 7. Marşrutu tüneldən ayır (Detach)
async fn detach_route(
    State(state): State<AppState>,
    AxumPath((tunnel_id, route_id)): AxumPath<(String, String)>,
) -> Result<Json<bool>, (StatusCode, String)> {
    // 1. Marşrutu tapırıq ki, hansı layihəyə aid olduğunu bilək
    let route: Option<TunnelRoute> = sqlx::query_as("SELECT * FROM tunnel_routes WHERE id = ?")
        .bind(&route_id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or_default();

    if let Some(r) = route {
        // 2. Layihədən tünel ID-sini və bu tünelə aid cloudflare keçidini təmizləyirik
        let _ = sqlx::query("UPDATE applications SET tunnel_id = NULL, cloudflare_url = NULL WHERE id = ? AND tunnel_id = ?")
            .bind(&r.app_id)
            .bind(&tunnel_id)
            .execute(&state.db)
            .await;
    }

    // 3. Marşrut qeydini silirik
    sqlx::query("DELETE FROM tunnel_routes WHERE id = ?")
        .bind(&route_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

// 8. Tünelə bağlı bütün marşrutları gətir
async fn list_tunnel_routes(
    State(state): State<AppState>,
    AxumPath(tunnel_id): AxumPath<String>,
) -> Result<Json<Vec<TunnelRoute>>, (StatusCode, String)> {
    let routes = sqlx::query_as::<_, TunnelRoute>("SELECT * FROM tunnel_routes WHERE tunnel_id = ?")
        .bind(&tunnel_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(routes))
}

// Static scripts for remote daemon deployment
static DAEMON_SCRIPT: &str = include_str!("../scripts/remote_tunnel_daemon.py");
static SERVICE_FILE: &str = include_str!("../scripts/md-tunnel.service");

pub fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        result.push(CHARSET[(b0 >> 2) as usize] as char);
        result.push(CHARSET[(((b0 & 3) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARSET[(((b1 & 15) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARSET[(b2 & 63) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

async fn build_server_tunnels_config(
    db: &sqlx::SqlitePool,
    server_id: &str,
) -> Result<serde_json::Value, String> {
    let tunnels = sqlx::query_as::<_, Tunnel>("SELECT * FROM tunnels WHERE server_id = ? ORDER BY created_at ASC")
        .bind(server_id)
        .fetch_all(db)
        .await
        .map_err(|e| e.to_string())?;

    let api_token: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_api_token'")
        .fetch_optional(db)
        .await
        .unwrap_or_default();
    let account_id: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_account_id'")
        .fetch_optional(db)
        .await
        .unwrap_or_default();
    let kv_id: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_kv_id'")
        .fetch_optional(db)
        .await
        .unwrap_or_default();

    let mut tunnel_items = Vec::new();
    for t in &tunnels {
        let routes = sqlx::query_as::<_, TunnelRoute>("SELECT * FROM tunnel_routes WHERE tunnel_id = ?")
            .bind(&t.id)
            .fetch_all(db)
            .await
            .unwrap_or_default();

        let mut app_keys = vec![t.name.clone()];
        for r in &routes {
            if let Ok(Some(app)) = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
                .bind(&r.app_id)
                .fetch_optional(db)
                .await
            {
                if !app_keys.contains(&app.name) {
                    app_keys.push(app.name);
                }
            }
        }

        let target_port = routes.first().map(|r| r.target_port).unwrap_or(8080);
        tunnel_items.push(serde_json::json!({
            "id": t.id,
            "name": t.name,
            "tunnel_type": t.tunnel_type,
            "target_port": target_port,
            "app_keys": app_keys
        }));
    }

    Ok(serde_json::json!({
        "cloudflare": {
            "api_token": api_token.unwrap_or_default(),
            "account_id": account_id.unwrap_or_default(),
            "kv_id": kv_id.unwrap_or_default()
        },
        "tunnels": tunnel_items
    }))
}

async fn execute_remote_tunnel_sync(
    state: &AppState,
    server: &Server,
    tunnels_config: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    if server.ip == "local" || server.ip == "127.0.0.1" {
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::fs::create_dir_all("/etc/masterdeploy");
            let _ = std::fs::write("/etc/masterdeploy/tunnels.json", tunnels_config.to_string());
        }
        return Ok(serde_json::json!({
            "is_local": true,
            "success": true,
            "message": "Yerli server üçün konfiqurasiya saxlanıldı"
        }));
    }

    let key_content = if let Some(ref kid) = server.ssh_key_id {
        let db_key: Option<(String,)> = sqlx::query_as("SELECT private_key FROM ssh_keys WHERE id = ?")
            .bind(kid)
            .fetch_optional(&state.db)
            .await
            .unwrap_or(None);
        db_key.map(|r| r.0).unwrap_or_else(|| server.ssh_key.clone())
    } else {
        server.ssh_key.clone()
    };

    let key_data = if key_content.contains("BEGIN ") {
        key_content.clone()
    } else {
        std::fs::read_to_string(key_content.trim()).unwrap_or_else(|_| server.ssh_key.clone())
    };

    let temp_key_path = crate::ssh::write_temp_ssh_key(&format!("tunnel_{}", server.id), &key_data)?;

    let daemon_b64 = base64_encode(DAEMON_SCRIPT.as_bytes());
    let service_b64 = base64_encode(SERVICE_FILE.as_bytes());
    let config_str = tunnels_config.to_string();
    let config_b64 = base64_encode(config_str.as_bytes());

    let remote_cmd = format!(
        "sudo mkdir -p /etc/masterdeploy && \
         echo '{daemon_b64}' | base64 -d | sudo tee /etc/masterdeploy/remote_tunnel_daemon.py > /dev/null && \
         echo '{service_b64}' | base64 -d | sudo tee /etc/systemd/system/md-tunnel.service > /dev/null && \
         echo '{config_b64}' | base64 -d | sudo tee /etc/masterdeploy/tunnels.json > /dev/null && \
         sudo chmod +x /etc/masterdeploy/remote_tunnel_daemon.py && \
         (command -v cloudflared >/dev/null 2>&1 || (curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /tmp/cloudflared && sudo install -m 755 /tmp/cloudflared /usr/local/bin/cloudflared && rm -f /tmp/cloudflared) || true) && \
         sudo systemctl daemon-reload && \
         sudo systemctl enable md-tunnel.service && \
         sudo systemctl restart md-tunnel.service"
    );

    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };

    let res = tokio::process::Command::new(ssh_bin)
        .args(&[
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=15",
            "-i", &temp_key_path,
            &format!("{}@{}", server.ssh_user, server.ip),
            &remote_cmd,
        ])
        .output()
        .await;

    let _ = std::fs::remove_file(&temp_key_path);

    match res {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let success = out.status.success();
            Ok(serde_json::json!({
                "executed": true,
                "success": success,
                "stdout": stdout,
                "stderr": stderr
            }))
        }
        Err(e) => Err(format!("SSH əmri icra edilə bilmədi: {}", e)),
    }
}

// 9. Uzaq VM-ə tünel konfiqurasiyasını sinxronizasiya et və Watchdog Daemon-u təmin et
async fn sync_tunnel_to_remote(
    State(state): State<AppState>,
    AxumPath(tunnel_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let tunnel = sqlx::query_as::<_, Tunnel>("SELECT * FROM tunnels WHERE id = ?")
        .bind(&tunnel_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Tünel tapılmadı".to_string()))?;

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&tunnel.server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server tapılmadı".to_string()))?;

    let tunnels_config = build_server_tunnels_config(&state.db, &server.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    println!("[TUNNEL SYNC] Server: {} üçün tünel konfiqurasiyası hazırlandı: {}", server.name, tunnel.name);

    let remote_res = execute_remote_tunnel_sync(&state, &server, &tunnels_config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Tünellərin statusunu aktivləşdiririk
    let _ = sqlx::query("UPDATE tunnels SET status = 'active' WHERE server_id = ?")
        .bind(&server.id)
        .execute(&state.db)
        .await;

    Ok(Json(serde_json::json!({
        "success": true,
        "tunnel_id": tunnel.id,
        "server_id": server.id,
        "server_name": server.name,
        "remote_sync": remote_res,
        "config": tunnels_config
    })))
}

// 10. Müəyyən bir serverin bütün tünellərini uzaq VM-ə sinxronizasiya et
async fn sync_server_tunnels_to_remote(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Server tapılmadı".to_string()))?;

    let tunnels_config = build_server_tunnels_config(&state.db, &server.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    println!("[TUNNEL SYNC] Server: {} üzrə bütün tünellər sinxronizasiya edilir", server.name);

    let remote_res = execute_remote_tunnel_sync(&state, &server, &tunnels_config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let _ = sqlx::query("UPDATE tunnels SET status = 'active' WHERE server_id = ?")
        .bind(&server.id)
        .execute(&state.db)
        .await;

    Ok(Json(serde_json::json!({
        "success": true,
        "server_id": server.id,
        "server_name": server.name,
        "remote_sync": remote_res,
        "config": tunnels_config
    })))
}

async fn list_all_tunnel_history(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::models::TunnelLinkHistory>>, (StatusCode, String)> {
    let history = sqlx::query_as::<_, crate::models::TunnelLinkHistory>(
        "SELECT id, app_id, app_name, tunnel_id, previous_url, new_url, status, \
         CAST(assigned_at AS TEXT) as assigned_at, CAST(expired_at AS TEXT) as expired_at \
         FROM tunnel_link_history ORDER BY assigned_at DESC LIMIT 100"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(history))
}

async fn list_app_tunnel_history(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<Vec<crate::models::TunnelLinkHistory>>, (StatusCode, String)> {
    let history = sqlx::query_as::<_, crate::models::TunnelLinkHistory>(
        "SELECT id, app_id, app_name, tunnel_id, previous_url, new_url, status, \
         CAST(assigned_at AS TEXT) as assigned_at, CAST(expired_at AS TEXT) as expired_at \
         FROM tunnel_link_history WHERE app_id = ? ORDER BY assigned_at DESC LIMIT 50"
    )
    .bind(&app_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(history))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base64_encode() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b"MasterDeploy Multi-Node"), "TWFzdGVyRGVwbG95IE11bHRpLU5vZGU=");
        assert_eq!(base64_encode(b""), "");
    }

    #[test]
    fn test_daemon_and_service_embedded_assets() {
        assert!(DAEMON_SCRIPT.contains("MasterDeploy Multi-Tunnel Watchdog Daemon"));
        assert!(DAEMON_SCRIPT.contains("update_cloudflare_kv"));
        assert!(SERVICE_FILE.contains("ExecStart=/usr/bin/python3 /etc/masterdeploy/remote_tunnel_daemon.py"));
    }
}
