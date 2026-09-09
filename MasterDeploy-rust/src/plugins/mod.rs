pub mod cloudflare;

use axum::{
    routing::{get, post},
    Router,
    Json,
    extract::{State, Path as AxumPath},
    http::StatusCode,
};
use serde::{Serialize, Deserialize};
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub installed: bool,
    pub version: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/plugins", get(list_plugins))
        .route("/api/plugins/:id/servers", get(get_plugin_servers))
        .route("/api/plugins/:id/install", post(install_plugin))
        .route("/api/plugins/:id/uninstall", post(uninstall_plugin))
        .route("/proxy/:app_name/*path", axum::routing::any(cloudflare::proxy_handler))
        .route("/proxy/:app_name", axum::routing::any(cloudflare::proxy_handler))
}

// Hansı serverlərdə bu pluginin quraşdırıldığını qaytarır
async fn get_plugin_servers(
    State(state): State<AppState>,
    AxumPath(plugin_id): AxumPath<String>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, String)> {
    let servers = sqlx::query_as::<_, (String, String, String)>(
        "SELECT s.id, s.name, s.ip FROM servers s"
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let installed_server_ids = sqlx::query_scalar::<_, String>(
        "SELECT server_id FROM server_plugins WHERE plugin_name = ? AND status = 'installed'"
    )
    .bind(&plugin_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let result = servers.into_iter().map(|(id, name, ip)| {
        let is_installed = installed_server_ids.contains(&id);
        serde_json::json!({
            "server_id": id,
            "server_name": name,
            "server_ip": ip,
            "installed": is_installed
        })
    }).collect();

    Ok(Json(result))
}

async fn list_plugins(State(state): State<AppState>) -> Result<Json<Vec<PluginInfo>>, (StatusCode, String)> {
    // Verilənlər bazasından modulların statusunu yoxlayırıq. 
    // Yoxdursa db-yə ilkin olaraq əlavə edirik.
    let _ = sqlx::query("CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, name TEXT, description TEXT, installed INTEGER, version TEXT)")
        .execute(&state.db)
        .await;

    let plugins_in_db = sqlx::query_as::<_, (String, String, String, i32, String)>("SELECT id, name, description, installed, version FROM plugins")
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    let mut list = Vec::new();
    let has_cloudflare = plugins_in_db.iter().any(|p| p.0 == "cloudflare");

    if !has_cloudflare {
        let _ = sqlx::query("INSERT INTO plugins (id, name, description, installed, version) VALUES ('cloudflare', 'Cloudflare Tunnel', 'Multi-Node Müstəqil Tünel İnteqrasiyası', 0, '2.0.0')")
            .execute(&state.db)
            .await;
        list.push(PluginInfo {
            id: "cloudflare".to_string(),
            name: "Cloudflare Tunnel".to_string(),
            description: "Multi-Node Müstəqil Tünel İnteqrasiyası".to_string(),
            installed: false,
            version: "2.0.0".to_string(),
        });
    }

    for p in plugins_in_db {
        list.push(PluginInfo {
            id: p.0,
            name: p.1,
            description: p.2,
            installed: p.3 == 1,
            version: p.4,
        });
    }

    Ok(Json(list))
}

async fn install_plugin(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    payload: Option<Json<crate::models::InstallServerPluginInput>>,
) -> Result<Json<bool>, (StatusCode, String)> {
    // 1. Qlobal statusu yeniləyirik
    let _ = sqlx::query("UPDATE plugins SET installed = 1 WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await;

    // 2. Server-scoped quraşdırma
    if let Some(Json(input)) = payload {
        if input.install_all.unwrap_or(false) {
            // Bütün serverlərdə quraşdırırıq
            let server_ids: Vec<String> = sqlx::query_scalar("SELECT id FROM servers")
                .fetch_all(&state.db)
                .await
                .unwrap_or_default();

            for s_id in server_ids {
                let rec_id = uuid::Uuid::new_v4().to_string();
                let _ = sqlx::query(
                    "INSERT INTO server_plugins (id, server_id, plugin_name, status, config_json) \
                     VALUES (?, ?, ?, 'installed', ?) \
                     ON CONFLICT(server_id, plugin_name) DO UPDATE SET status = 'installed', updated_at = CURRENT_TIMESTAMP"
                )
                .bind(&rec_id)
                .bind(&s_id)
                .bind(&id)
                .bind(&input.config_json)
                .execute(&state.db)
                .await;

                if id == "cloudflare" {
                    let t_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tunnels WHERE server_id = ?")
                        .bind(&s_id)
                        .fetch_one(&state.db)
                        .await
                        .unwrap_or(0);
                    if t_count == 0 {
                        let t_id = uuid::Uuid::new_v4().to_string();
                        let _ = sqlx::query(
                            "INSERT INTO tunnels (id, server_id, name, tunnel_type, status) VALUES (?, ?, 'Tunel-A (Shared)', 'shared', 'active')"
                        )
                        .bind(&t_id)
                        .bind(&s_id)
                        .execute(&state.db)
                        .await;
                    }
                }
            }
            println!("[PLUGIN] Modul '{}' BÜTÜN serverlərdə aktiv edildi.", id);
        } else if let Some(server_id) = input.server_id {
            // Yalnız seçilmiş fərdi serverdə quraşdırırıq
            let rec_id = uuid::Uuid::new_v4().to_string();
            let _ = sqlx::query(
                "INSERT INTO server_plugins (id, server_id, plugin_name, status, config_json) \
                 VALUES (?, ?, ?, 'installed', ?) \
                 ON CONFLICT(server_id, plugin_name) DO UPDATE SET status = 'installed', updated_at = CURRENT_TIMESTAMP"
            )
            .bind(&rec_id)
            .bind(&server_id)
            .bind(&id)
            .bind(&input.config_json)
            .execute(&state.db)
            .await;

            if id == "cloudflare" {
                let t_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tunnels WHERE server_id = ?")
                    .bind(&server_id)
                    .fetch_one(&state.db)
                    .await
                    .unwrap_or(0);
                if t_count == 0 {
                    let t_id = uuid::Uuid::new_v4().to_string();
                    let _ = sqlx::query(
                        "INSERT INTO tunnels (id, server_id, name, tunnel_type, status) VALUES (?, ?, 'Tunel-A (Shared)', 'shared', 'active')"
                    )
                    .bind(&t_id)
                    .bind(&server_id)
                    .execute(&state.db)
                    .await;
                }
            }
            println!("[PLUGIN] Modul '{}' server '{}' üçün aktiv edildi.", id, server_id);
        }
    }

    Ok(Json(true))
}

async fn uninstall_plugin(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    payload: Option<Json<crate::models::InstallServerPluginInput>>,
) -> Result<Json<bool>, (StatusCode, String)> {
    if let Some(Json(input)) = payload {
        if let Some(server_id) = input.server_id {
            // Yalnız həmin serverdən silirik
            let _ = sqlx::query("DELETE FROM server_plugins WHERE server_id = ? AND plugin_name = ?")
                .bind(&server_id)
                .bind(&id)
                .execute(&state.db)
                .await;
            println!("[PLUGIN] Modul '{}' server '{}' üçün ləğv edildi.", id, server_id);
            return Ok(Json(true));
        }
    }

    // Əgər server göstərilməyibsə, qlobal ləğv edirik
    sqlx::query("UPDATE plugins SET installed = 0 WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let _ = sqlx::query("DELETE FROM server_plugins WHERE plugin_name = ?")
        .bind(&id)
        .execute(&state.db)
        .await;

    Ok(Json(true))
}

