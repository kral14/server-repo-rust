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

        let db_clone = state.db.clone();
        let app_id_clone = app_id.clone();
        let app_name_clone = app.name.clone();
        let cf_worker_url_clone = app.cf_worker_url.clone();
        let ssh_bin_clone = ssh_bin.to_string();
        let ssh_user_clone = server.ssh_user.clone();
        let ip_clone = server.ip.clone();
        let bash_cmd_clone = bash_cmd.clone();

        tokio::spawn(async move {
            // 1. Tünel başladan docker əmrini icra edirik
            let run_future = async {
                tokio::process::Command::new(&ssh_bin_clone)
                    .args(&[
                        "-o", "StrictHostKeyChecking=no",
                        "-o", "BatchMode=yes",
                        "-o", "ConnectTimeout=5",
                        "-i", &temp_key_path,
                        &format!("{}@{}", ssh_user_clone, ip_clone),
                        &bash_cmd_clone
                    ])
                    .output()
                    .await
            };

            let _output_res = tokio::time::timeout(std::time::Duration::from_millis(20000), run_future).await;
            
            // 2. Arxa planda 10 dəfə (cəmi ~15 saniyə) loqları yoxlayıb trycloudflare linkini axtarırıq
            let log_cmd = if is_local {
                format!("docker logs cf-tunnel-{}", app_id_clone)
            } else {
                format!("sudo docker logs cf-tunnel-{}", app_id_clone)
            };

            for _ in 0..10 {
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                
                let out_res = if is_local {
                    tokio::process::Command::new("sh")
                        .arg("-c")
                        .arg(&log_cmd)
                        .output()
                        .await
                } else {
                    tokio::process::Command::new(&ssh_bin_clone)
                        .args(&[
                            "-o", "StrictHostKeyChecking=no",
                            "-o", "BatchMode=yes",
                            "-o", "ConnectTimeout=2",
                            "-i", &temp_key_path,
                            &format!("{}@{}", ssh_user_clone, ip_clone),
                            &log_cmd
                        ])
                        .output()
                        .await
                };

                if let Ok(out) = out_res {
                    let log_str = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
                    let mut cloudflare_url = None;
                    for line in log_str.lines() {
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
                        println!("[TUNNEL] Uğurla yeni tunel linki tapıldı: {}", url);
                        let _ = sqlx::query("UPDATE applications SET cloudflare_url = ? WHERE id = ?")
                            .bind(url)
                            .bind(&app_id_clone)
                            .execute(&db_clone)
                            .await;
                        
                        println!("[TUNNEL] Link KV bazasına (Cloudflare) yazılmağa göndərilir...");
                        match send_url_to_kv(&db_clone, &app_name_clone, cf_worker_url_clone.clone(), url).await {
                            Ok(_) => println!("[TUNNEL] Link uğurla Cloudflare KV yaddaşına yazıldı!"),
                            Err(e) => eprintln!("[TUNNEL ERROR] Linki KV yaddaşına yazarkən xəta baş verdi: {}", e),
                        }
                        break;
                    } else {
                        println!("[TUNNEL] Tunel linki axtarılır... (Nəticə hələ tapılmayıb)");
                    }
                }
            }

            let _ = std::fs::remove_file(&temp_key_path);
        });
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

use std::sync::Mutex;
use std::time::{Instant, Duration};

static LOG_CACHE: std::sync::OnceLock<Mutex<std::collections::HashMap<String, (String, Option<String>, Instant)>>> = std::sync::OnceLock::new();

fn get_cache() -> &'static Mutex<std::collections::HashMap<String, (String, Option<String>, Instant)>> {
    LOG_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

pub async fn get_cloudflare_tunnel_logs(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let cache = get_cache();
    {
        let lock = cache.lock().unwrap();
        if let Some((cached_logs, cached_url, last_time)) = lock.get(&app_id) {
            if last_time.elapsed() < Duration::from_secs(8) {
                return Ok(Json(serde_json::json!({
                    "logs": cached_logs,
                    "cloudflare_url": cached_url
                })));
            }
        }
    }

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

        let run_future = async {
            tokio::process::Command::new(ssh_bin)
                .args(&[
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "BatchMode=yes",
                    "-o", "ConnectTimeout=8",
                    "-i", &temp_key_path,
                    &format!("{}@{}", server.ssh_user, server.ip),
                    &bash_cmd
                ])
                .output()
                .await
        };

        let output_res = tokio::time::timeout(std::time::Duration::from_millis(20000), run_future).await;
        let _ = std::fs::remove_file(&temp_key_path);
        
        let out = match output_res {
            Ok(Ok(out)) => out,
            _ => {
                return Err((StatusCode::INTERNAL_SERVER_ERROR, "SSH tunnel log request timed out (20s)".to_string()));
            }
        };
        String::from_utf8_lossy(&out.stdout).to_string() + "\n" + &String::from_utf8_lossy(&out.stderr)
    };

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
        let should_update = app.cloudflare_url.is_none() || app.cloudflare_url.as_ref().unwrap() != url;
        if should_update {
            let _ = sqlx::query("UPDATE applications SET cloudflare_url = ? WHERE id = ?")
                .bind(url)
                .bind(&app_id)
                .execute(&state.db)
                .await;
            
            let _ = send_url_to_kv(&state.db, &app.name, app.cf_worker_url.clone(), url).await;
        }
    }

    {
        let mut lock = cache.lock().unwrap();
        lock.insert(app_id.clone(), (output_str.clone(), cloudflare_url.clone(), Instant::now()));
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

async fn send_url_to_kv(db: &sqlx::SqlitePool, app_name: &str, cf_worker_url: Option<String>, url: &str) -> Result<(), String> {
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

    let token = api_token.filter(|t| !t.is_empty())
        .ok_or_else(|| "Cloudflare API Token tapılmadı (ayarlar boşdur)!".to_string())?;
    let acc = account_id.filter(|a| !a.is_empty())
        .ok_or_else(|| "Cloudflare Account ID tapılmadı (ayarlar boşdur)!".to_string())?;
    let kv = kv_id.filter(|k| !k.is_empty())
        .ok_or_else(|| "Cloudflare KV Namespace ID tapılmadı (ayarlar boşdur)!".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("reqwest client yaradıla bilmədi: {}", e))?;

    let mut keys_to_write = vec![app_name.to_string()];
    
    if let Some(worker_url) = cf_worker_url {
        let clean_url = worker_url
            .trim()
            .trim_start_matches("https://")
            .trim_start_matches("http://");
        if let Some(subdomain) = clean_url.split('.').next() {
            if !subdomain.is_empty() && subdomain != app_name {
                keys_to_write.push(subdomain.to_string());
            }
        }
    }

    for key in keys_to_write {
        let kv_url = format!(
            "https://api.cloudflare.com/client/v4/accounts/{}/storage/kv/namespaces/{}/values/{}",
            acc, kv, key
        );
        println!("[KV UPDATE] Key: '{}' üçün Cloudflare API-yə PUT sorğusu göndərilir...", key);
        let res = client.put(&kv_url)
            .bearer_auth(&token)
            .header("Content-Type", "text/plain")
            .body(url.to_string())
            .send()
            .await
            .map_err(|e| format!("Cloudflare KV API-yə qoşulma xətası: {}", e))?;

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();
            return Err(format!("Cloudflare API xətası (status {}): {}", status, err_text));
        }
        println!("[KV UPDATE] Key: '{}' uğurla yeniləndi (200 OK).", key);
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CloudflareSettings {
    pub api_token: String,
    pub account_id: String,
    pub kv_id: String,
    pub worker_url: String,
}

pub async fn get_cloudflare_settings(
    State(state): State<AppState>,
) -> Result<Json<CloudflareSettings>, (StatusCode, String)> {
    let api_token: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_api_token'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();
    let account_id: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_account_id'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();
    let kv_id: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_kv_id'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();
    let worker_url: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_worker_url'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();

    Ok(Json(CloudflareSettings {
        api_token,
        account_id,
        kv_id,
        worker_url,
    }))
}

pub async fn save_cloudflare_settings(
    State(state): State<AppState>,
    Json(payload): Json<CloudflareSettings>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let keys = vec![
        ("cf_api_token", payload.api_token),
        ("cf_account_id", payload.account_id),
        ("cf_kv_id", payload.kv_id),
        ("cf_worker_url", payload.worker_url),
    ];

    for (k, v) in keys {
        let _ = sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
            .bind(k)
            .bind(v)
            .execute(&state.db)
            .await;
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn check_cloudflare_connection(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let api_token: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_api_token'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();
    let account_id: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_account_id'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();
    let kv_id: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_kv_id'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();

    if api_token.is_empty() || account_id.is_empty() || kv_id.is_empty() {
        return Ok(Json(serde_json::json!({ "status": "incomplete", "message": "Konfiqurasiya məlumatları tam doldurulmayıb." })));
    }

    if let Ok(client) = reqwest::Client::builder().timeout(std::time::Duration::from_secs(8)).build() {
        let test_url = format!(
            "https://api.cloudflare.com/client/v4/accounts/{}/storage/kv/namespaces/{}",
            account_id, kv_id
        );
        let res = client.get(&test_url)
            .bearer_auth(&api_token)
            .send()
            .await;

        match res {
            Ok(response) => {
                if response.status().is_success() {
                    Ok(Json(serde_json::json!({ 
                        "status": "connected", 
                        "message": "Qoşulma uğurla quruldu! Cloudflare ilə əlaqə aktivdir." 
                    })))
                } else {
                    let err_text = response.text().await.unwrap_or_default();
                    Ok(Json(serde_json::json!({ 
                        "status": "error", 
                        "message": format!("Cloudflare API xətası: {}", err_text) 
                    })))
                }
            }
            Err(e) => {
                Ok(Json(serde_json::json!({ 
                    "status": "error", 
                    "message": format!("KV bazasına qoşulmaq mümkün olmadı (Timeout və ya şəbəkə xətası): {}", e) 
                })))
            }
        }
    } else {
        Ok(Json(serde_json::json!({ "status": "error", "message": "Client build error" })))
    }
}

pub async fn deploy_worker(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let app = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
        .bind(&app_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Application not found".to_string()))?;

    let api_token: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_api_token'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();
    let account_id: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_account_id'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();
    let kv_id: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_kv_id'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();

    if api_token.is_empty() || account_id.is_empty() || kv_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Cloudflare ayarları (Token, Account ID, KV ID) tamamlanmayıb.".to_string()));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Client build error: {}", e)))?;

    let script_name = sanitize_cf_script_name(&app.name);

    let worker_js = format!(
        r#"export default {{
    async fetch(request, env, ctx) {{
        if (request.method === "OPTIONS") {{
            const reqOrigin = request.headers.get("Origin") || "*";
            return new Response(null, {{
                status: 204,
                headers: {{
                    "Access-Control-Allow-Origin": reqOrigin,
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD",
                    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Tenant-ID, X-Setup-Token, X-Super-Admin-Key",
                    "Access-Control-Max-Age": "86400",
                }}
            }});
        }}

        try {{
            const url = new URL(request.url);
            const country = request.headers.get("CF-IPCountry") || "XX";
            const reqOrigin = request.headers.get("Origin") || "*";

            let APP_NAME = "{}";
            let targetPath = url.pathname + url.search;
            let liveUrl = null;

            if (url.pathname.startsWith("/koyeb/")) {{
                APP_NAME = "mezuniyyet-koyeb";
                targetPath = url.pathname.replace("/koyeb", "") + url.search;
            }}

            const blockedCountries = ["CN", "RU", "KP"];
            if (blockedCountries.includes(country)) {{
                return new Response("Sizin coğrafi yerləşməniz üçün giriş bloklanıb.", {{ status: 403 }});
            }}

            const authHeader = request.headers.get("Authorization");
            if (authHeader && authHeader.startsWith("Bearer ")) {{
                const token = authHeader.substring(7);
                if (!validateJWTStructure(token)) {{
                    return new Response(
                        JSON.stringify({{ error: "Xətalı və ya etibarsız təhlükəsizlik tokeni (Malformed JWT)." }}),
                        {{ status: 401, headers: {{ "Content-Type": "application/json" }} }}
                    );
                }}
            }}

            if (isZararliSorgu(url.search) || isZararliSorgu(url.pathname)) {{
                return new Response("Təhlükəsizlik qaydalarının pozulması aşkarlandı.", {{ status: 400 }});
            }}

            try {{
                const subdomain = url.hostname.split('.')[0];
                let activeTunnelUrl = null;

                if (env.GATE_LIMITS) {{
                    try {{
                        activeTunnelUrl = await env.GATE_LIMITS.get(subdomain);
                        if (!activeTunnelUrl) {{
                            activeTunnelUrl = await env.GATE_LIMITS.get("TUNNEL_URL");
                        }}
                    }} catch (kvErr) {{
                        activeTunnelUrl = null;
                    }}
                }}

                if (!activeTunnelUrl) {{
                    activeTunnelUrl = env.TUNNEL_URL;
                }}

                liveUrl = await env.TUNNEL_DB.get(APP_NAME);
            }} catch (kvErr) {{
                console.warn("KV xətası:", kvErr.message);
                liveUrl = env.TUNNEL_URL;
            }}

            if (!liveUrl) {{
                return new Response(`[Smart Gate] '${{APP_NAME}}' üçün canlı link tapılmadı.`, {{ status: 503 }});
            }}

            const targetUrl = new URL(targetPath, liveUrl.trim());
            const modifiedHeaders = new Headers(request.headers);

            const gatewaySecret = env.GATEWAY_SECRET || "default_gateway_secret_key_123";
            modifiedHeaders.set("X-Gateway-Secret", gatewaySecret);
            modifiedHeaders.set("X-Gateway-Secured-By", "Cloudflare-Smart-Gate");

            const modifiedRequest = new Request(targetUrl, {{
                method: request.method,
                headers: modifiedHeaders,
                body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
                redirect: 'manual'
            }});

            const response = await fetch(modifiedRequest);
            const responseHeaders = new Headers(response.headers);
            responseHeaders.set("Access-Control-Allow-Origin", reqOrigin);
            responseHeaders.set("Access-Control-Allow-Credentials", "true");
            responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD");
            responseHeaders.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Tenant-ID, X-Setup-Token, X-Super-Admin-Key");

            return new Response(response.body, {{
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
            }});
        }} catch (globalErr) {{
            return new Response(
                JSON.stringify({{ error: "İnternet Gateway Xətası", details: globalErr.message }}),
                {{
                    status: 500,
                    headers: {{
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": reqOrigin,
                        "Access-Control-Allow-Credentials": "true"
                    }}
                }}
            );
        }}
    }}
}};

function validateJWTStructure(token) {{
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    try {{
        const payloadDecoded = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(payloadDecoded);
        if (payload.exp) {{
            const currentTimestamp = Math.floor(Date.now() / 1000);
            if (currentTimestamp >= payload.exp) return false;
        }}
        return true;
    }} catch (e) {{
        return false;
    }}
}}

function isZararliSorgu(text) {{
    if (!text) return false;
    let decoded;
    try {{
        decoded = decodeURIComponent(text).toLowerCase();
    }} catch (e) {{
        decoded = text.toLowerCase();
    }}
    const patterns = [
        /union\s+select/i,
        /select\s+.*\s+from/i,
        /insert\s+into/i,
        /delete\s+from/i,
        /drop\s+database/i,
        /or\s+\d+\s*=\s*\d+/i,
        /--/,
        /<script[^>]*>/i,
        /javascript:/i,
        /\.\.\//,
        /\.\.\\/
    ];
    return patterns.some(pattern => pattern.test(decoded));
}}"#,
        app.name
    );

    let metadata_json = serde_json::json!({
        "main_module": "index.js",
        "bindings": [
            {
                "type": "kv_namespace",
                "name": "TUNNEL_DB",
                "namespace_id": kv_id
            }
        ]
    });

    let metadata_part = reqwest::multipart::Part::text(metadata_json.to_string())
        .mime_str("application/json")
        .map_err(|e: reqwest::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let script_part = reqwest::multipart::Part::text(worker_js)
        .file_name("index.js")
        .mime_str("application/javascript+module")
        .map_err(|e: reqwest::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let form = reqwest::multipart::Form::new()
        .part("metadata", metadata_part)
        .part("script", script_part);

    let deploy_url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/workers/scripts/{}",
        account_id, script_name
    );

    let res = client.put(&deploy_url)
        .bearer_auth(&api_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Cloudflare API request failed: {}", e)))?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err((StatusCode::BAD_REQUEST, format!("Cloudflare API xətası: {}", err_text)));
    }

    let subdomain_url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/workers/subdomain",
        account_id
    );
    let mut worker_url = format!("https://{}.workers.dev", script_name);

    if let Ok(sub_res) = client.get(&subdomain_url).bearer_auth(&api_token).send().await {
        if sub_res.status().is_success() {
            if let Ok(json) = sub_res.json::<serde_json::Value>().await {
                if let Some(subdomain) = json.pointer("/result/subdomain").and_then(|v| v.as_str()) {
                    worker_url = format!("https://{}.{}.workers.dev", script_name, subdomain);
                }
            }
        }
    }

    sqlx::query("UPDATE applications SET cf_worker_url = ? WHERE id = ?")
        .bind(&worker_url)
        .bind(&app_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true, "worker_url": worker_url })))
}

pub async fn delete_worker(
    State(state): State<AppState>,
    AxumPath(app_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let app = sqlx::query_as::<_, Application>("SELECT * FROM applications WHERE id = ?")
        .bind(&app_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Application not found".to_string()))?;

    let api_token: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_api_token'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();
    let account_id: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_account_id'")
        .fetch_optional(&state.db).await.unwrap_or_default().unwrap_or_default();

    if api_token.is_empty() || account_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Cloudflare ayarları (Token, Account ID) tamamlanmayıb.".to_string()));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Client build error: {}", e)))?;

    let script_name = sanitize_cf_script_name(&app.name);
    let delete_url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/workers/scripts/{}",
        account_id, script_name
    );

    let res = client.delete(&delete_url)
        .bearer_auth(&api_token)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Cloudflare API request failed: {}", e)))?;

    if !res.status().is_success() && res.status() != reqwest::StatusCode::NOT_FOUND {
        let err_text = res.text().await.unwrap_or_default();
        return Err((StatusCode::BAD_REQUEST, format!("Cloudflare API xətası: {}", err_text)));
    }

    sqlx::query("UPDATE applications SET cf_worker_url = NULL WHERE id = ?")
        .bind(&app_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

fn sanitize_cf_script_name(name: &str) -> String {
    let mut result = String::new();
    for c in name.chars() {
        let low = c.to_lowercase().to_string();
        for lc in low.chars() {
            match lc {
                'ə' => result.push('e'),
                'ı' | 'i' | '\u{307}' => result.push('i'),
                'ö' => result.push('o'),
                'ü' => result.push('u'),
                'ç' => result.push('c'),
                'ş' => result.push('s'),
                'ğ' => result.push('g'),
                _ if lc.is_ascii_alphanumeric() => result.push(lc),
                '-' | '_' | ' ' => {
                    if result.chars().last() != Some('-') {
                        result.push('-');
                    }
                }
                _ => {}
            }
        }
    }
    result.trim_matches('-').to_string()
}



