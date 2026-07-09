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
        .route("/api/plugins/:id/install", post(install_plugin))
        .route("/api/plugins/:id/uninstall", post(uninstall_plugin))
        .route("/proxy/:app_name/*path", axum::routing::any(cloudflare::proxy_handler))
        .route("/proxy/:app_name", axum::routing::any(cloudflare::proxy_handler))
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
        let _ = sqlx::query("INSERT INTO plugins (id, name, description, installed, version) VALUES ('cloudflare', 'Cloudflare Tunnel', 'Sabit Cloudflare Quick Tunnel inteqrasiyası', 0, '1.0.0')")
            .execute(&state.db)
            .await;
        list.push(PluginInfo {
            id: "cloudflare".to_string(),
            name: "Cloudflare Tunnel".to_string(),
            description: "Sabit Cloudflare Quick Tunnel inteqrasiyası".to_string(),
            installed: false,
            version: "1.0.0".to_string(),
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

async fn install_plugin(State(state): State<AppState>, AxumPath(id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query("UPDATE plugins SET installed = 1 WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

async fn uninstall_plugin(State(state): State<AppState>, AxumPath(id): AxumPath<String>) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query("UPDATE plugins SET installed = 0 WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}
