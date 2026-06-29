use axum::{
    extract::{State, Path as AxumPath},
    http::StatusCode,
    Json,
};
use crate::AppState;
use crate::models::{Application, Server};

pub async fn start_cloudflare_tunnel(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
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

    let port = app.port;
    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };

    let (bash_cmd, is_local) = if server.ip == "local" || server.ip == "127.0.0.1" {
        (
            format!(
                "docker rm -f cf-tunnel-{} || true; \
                 docker run -d --name cf-tunnel-{} --network host cloudflare/cloudflared:latest tunnel --url http://localhost:{}",
                app_id, app_id, port
            ),
            true,
        )
    } else {
        (
            format!(
                "sudo docker rm -f cf-tunnel-{} || true; \
                 sudo docker run -d --name cf-tunnel-{} --network host cloudflare/cloudflared:latest tunnel --url http://localhost:{}",
                app_id, app_id, port
            ),
            false,
        )
    };

    if is_local {
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&bash_cmd)
            .output()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Local command execution failed: {}", e)))?;
    } else {
        let temp_key_path = format!("temp_tunnel_key_{}.key", uuid::Uuid::new_v4());
        let key_content = if server.ssh_key.contains("BEGIN ") {
            server.ssh_key.clone()
        } else {
            std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
        };

        std::fs::write(&temp_key_path, &key_content)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Key write error: {}", e)))?;

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

        let out_res = tokio::process::Command::new(ssh_bin)
            .args(&[
                "-o", "StrictHostKeyChecking=no",
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=10",
                "-i", &temp_key_path,
                &format!("{}@{}", server.ssh_user, server.ip),
                &bash_cmd
            ])
            .output()
            .await;

        let _ = std::fs::remove_file(&temp_key_path);
        out_res.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("SSH command execution failed: {}", e)))?;
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn get_cloudflare_tunnel_logs(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
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

    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };

    let (bash_cmd, is_local) = if server.ip == "local" || server.ip == "127.0.0.1" {
        (format!("docker logs cf-tunnel-{}", app_id), true)
    } else {
        (format!("sudo docker logs cf-tunnel-{}", app_id), false)
    };

    let output_str = if is_local {
        let out = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&bash_cmd)
            .output()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Local command execution failed: {}", e)))?;
        format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr))
    } else {
        let temp_key_path = format!("temp_tunnel_key_{}.key", uuid::Uuid::new_v4());
        let key_content = if server.ssh_key.contains("BEGIN ") {
            server.ssh_key.clone()
        } else {
            std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
        };

        std::fs::write(&temp_key_path, &key_content)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Key write error: {}", e)))?;

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

        let out_res = tokio::process::Command::new(ssh_bin)
            .args(&[
                "-o", "StrictHostKeyChecking=no",
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=10",
                "-i", &temp_key_path,
                &format!("{}@{}", server.ssh_user, server.ip),
                &bash_cmd
            ])
            .output()
            .await;

        let _ = std::fs::remove_file(&temp_key_path);
        let out = out_res.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("SSH command execution failed: {}", e)))?;
        String::from_utf8_lossy(&out.stdout).to_string() + "\n" + &String::from_utf8_lossy(&out.stderr)
    };

    // Extract trycloudflare URL
    let mut cloudflare_url = None;
    for line in output_str.lines() {
        if line.contains(".trycloudflare.com") {
            if let Some(start_idx) = line.find("https://") {
                let rest = &line[start_idx..];
                let end_idx = rest.find(|c: char| c.is_whitespace()).unwrap_or(rest.len());
                let url = &rest[..end_idx];
                cloudflare_url = Some(url.to_string());
                break;
            }
        }
    }

    if let Some(ref url) = cloudflare_url {
        let _ = sqlx::query("UPDATE applications SET cloudflare_url = ? WHERE id = ?")
            .bind(url)
            .bind(&app_id)
            .execute(&state.db)
            .await;
    }

    Ok(Json(serde_json::json!({
        "logs": output_str,
        "cloudflare_url": cloudflare_url
    })))
}

pub async fn stop_cloudflare_tunnel(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
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

    let ssh_bin = if cfg!(target_os = "windows") { "C:\\Windows\\System32\\OpenSSH\\ssh.exe" } else { "ssh" };

    let (bash_cmd, is_local) = if server.ip == "local" || server.ip == "127.0.0.1" {
        (format!("docker rm -f cf-tunnel-{} || true", app_id), true)
    } else {
        (format!("sudo docker rm -f cf-tunnel-{} || true", app_id), false)
    };

    if is_local {
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&bash_cmd)
            .output()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Local command execution failed: {}", e)))?;
    } else {
        let temp_key_path = format!("temp_tunnel_key_{}.key", uuid::Uuid::new_v4());
        let key_content = if server.ssh_key.contains("BEGIN ") {
            server.ssh_key.clone()
        } else {
            std::fs::read_to_string(server.ssh_key.trim()).unwrap_or_else(|_| server.ssh_key.clone())
        };

        std::fs::write(&temp_key_path, &key_content)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Key write error: {}", e)))?;

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

        let out_res = tokio::process::Command::new(ssh_bin)
            .args(&[
                "-o", "StrictHostKeyChecking=no",
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=10",
                "-i", &temp_key_path,
                &format!("{}@{}", server.ssh_user, server.ip),
                &bash_cmd
            ])
            .output()
            .await;

        let _ = std::fs::remove_file(&temp_key_path);
        out_res.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("SSH command execution failed: {}", e)))?;
    }

    let _ = sqlx::query("UPDATE applications SET cloudflare_url = NULL WHERE id = ?")
        .bind(&app_id)
        .execute(&state.db)
        .await;

    Ok(Json(serde_json::json!({ "success": true })))
}

// Reverse Proxy: Sorğuları dinamik olaraq ən son cloudflare linkinə yönləndirir
pub async fn proxy_handler(
    State(state): State<AppState>,
    axum::extract::Path(params): axum::extract::Path<std::collections::HashMap<String, String>>,
    req: axum::http::Request<axum::body::Body>,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let app_name = params.get("app_name")
        .ok_or((StatusCode::BAD_REQUEST, "Missing app name".to_string()))?;

    // Bazadan ən son cloudflare linkini tapırıq
    let app = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE name = ?")
        .bind(app_name)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, format!("Application '{}' not found", app_name)))?;

    let cloudflare_url = app.cloudflare_url
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "Cloudflare Tunnel is not running for this app".to_string()))?;

    // Alt yol (path) parametrini tapırıq
    let sub_path = params.get("path").map(|s| s.as_str()).unwrap_or("");
    let query = req.uri().query().unwrap_or("");
    
    // Hədəf URL qurulur
    let target_url = if query.is_empty() {
        format!("{}/{}", cloudflare_url.trim_end_matches('/'), sub_path)
    } else {
        format!("{}/{}?{}", cloudflare_url.trim_end_matches('/'), sub_path, query)
    };

    // Sorğu metodunu və başlıqlarını reqwest sorğusuna keçiririk (HTTP versiya uyuşmazlığını həll etmək üçün string vasitəsilə)
    let method_str = req.method().as_str();
    let reqwest_method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid HTTP method: {}", e)))?;
    let mut client_req = reqwest::Client::new().request(reqwest_method, &target_url);

    // Başlıqları kopyalayırıq
    let mut headers = reqwest::header::HeaderMap::new();
    for (k, v) in req.headers().iter() {
        // Host başlığını Cloudflare mane olmasın deyə ötürmürük
        if k != axum::http::header::HOST {
            if let Ok(value) = reqwest::header::HeaderValue::from_bytes(v.as_bytes()) {
                headers.insert(reqwest::header::HeaderName::from_bytes(k.as_str().as_bytes()).unwrap(), value);
            }
        }
    }
    client_req = client_req.headers(headers);

    // Body (gövdə) kopyalanması
    let body_bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    client_req = client_req.body(body_bytes);

    // Sorğunun icrası
    let res = client_req.send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Proxy request failed: {}", e)))?;

    // Cavabın axum response şəklində qaytarılması
    let mut builder = axum::response::Response::builder()
        .status(res.status().as_u16());

    for (k, v) in res.headers().iter() {
        if let Ok(value) = axum::http::HeaderValue::from_bytes(v.as_bytes()) {
            builder = builder.header(k.as_str(), value);
        }
    }

    let res_bytes = res.bytes()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(builder.body(axum::body::Body::from(res_bytes)).unwrap())
}

