use axum::{
    extract::State,
    http::StatusCode,
    Json, Router,
    routing::{get, post},
};
use crate::models::{ActivityLog, CreateActivityLogInput};
use crate::utils::add_activity_log_pro;

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/version", get(get_version))
        .route("/changelog", get(get_changelog))
        .route("/docs", get(get_docs))
        .route("/update", post(trigger_system_update))
        .route("/local-ssh-key", get(get_local_ssh_key))
}

pub fn settings_router() -> Router<AppState> {
    Router::new()
        .route("/github-token", get(get_github_token).post(save_github_token))
}

pub fn activity_logs_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_activity_logs).post(create_activity_log).delete(clear_activity_logs))
}

#[derive(serde::Deserialize)]
pub struct GithubTokenInput {
    pub token: String,
}

#[derive(serde::Deserialize)]
pub struct UpdatePayload {
    pub version: String,
}

pub async fn get_version() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "name": "DeployMaster"
    }))
}

pub async fn get_changelog(State(_state): State<AppState>) -> axum::response::Response {
    let local_content = tokio::fs::read_to_string("static/changelog.json")
        .await
        .unwrap_or_else(|_| "[]".to_string());

    let url = "https://raw.githubusercontent.com/kral14/server-repo-rust/main/MasterDeploy-rust/static/changelog.json";
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(2000))
        .build()
        .unwrap_or_default();

    let text = match client.get(url).send().await {
        Ok(res) if res.status().is_success() => {
            let remote_text = res.text().await.unwrap_or_default();
            if remote_text.trim().starts_with('[') {
                remote_text
            } else {
                local_content
            }
        }
        _ => local_content,
    };

    axum::response::Response::builder()
        .header("Content-Type", "application/json")
        .header("Cache-Control", "no-cache")
        .body(axum::body::Body::from(text))
        .unwrap()
}

pub async fn get_docs() -> axum::response::Response {
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

pub async fn get_local_ssh_key() -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let pub_key = crate::ssh::get_local_ssh_key_content()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(serde_json::json!({
        "public_key": pub_key
    })))
}

pub async fn get_github_token(State(state): State<AppState>) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'github_token'")
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let token = row.map(|r| r.0).unwrap_or_default();
    Ok(Json(serde_json::json!({ "token": token })))
}

pub async fn save_github_token(
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

    // Perform docker login
    crate::perform_docker_login(&input.token).await;

    add_activity_log_pro(&state.db, "Qlobal GitHub Personal Access Token (PAT) yeniləndi.", "info", Some("Settings"), Some("admin"), None, None).await;

    Ok(Json(true))
}

pub async fn list_activity_logs(State(state): State<AppState>) -> Result<Json<Vec<ActivityLog>>, (StatusCode, String)> {
    let logs = sqlx::query_as::<_, ActivityLog>("SELECT id, message, log_type, module, operator_name, target_id, ip_address, CAST(created_at AS TEXT) as created_at FROM activity_logs ORDER BY created_at DESC LIMIT 250")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(logs))
}

pub async fn create_activity_log(
    State(state): State<AppState>,
    Json(input): Json<CreateActivityLogInput>,
) -> Result<Json<bool>, (StatusCode, String)> {
    add_activity_log_pro(
        &state.db,
        &input.message,
        &input.log_type,
        input.module.as_deref(),
        input.operator_name.as_deref(),
        input.target_id.as_deref(),
        input.ip_address.as_deref()
    ).await;
    Ok(Json(true))
}

pub async fn clear_activity_logs(State(state): State<AppState>) -> Result<Json<bool>, (StatusCode, String)> {
    sqlx::query("DELETE FROM activity_logs")
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(true))
}

pub async fn trigger_system_update(
    State(state): State<AppState>,
    Json(payload): Json<UpdatePayload>
) -> Result<StatusCode, (StatusCode, String)> {
    let version = payload.version;
    let image = format!("ghcr.io/kral14/server-repo-rust:{}", version);
    
    let token_row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'github_token'")
        .fetch_optional(&state.db)
        .await
        .unwrap_or_default();
    
    let github_token = token_row.map(|r| r.0).unwrap_or_default();

    let mut check_success = false;
    
    if !github_token.is_empty() {
        let client = reqwest::Client::new();
        let token_url = "https://ghcr.io/token?scope=repository:kral14/server-repo-rust:pull";
        let token_res = client.get(token_url)
            .header("User-Agent", "DeployMaster")
            .send()
            .await;
            
        if let Ok(res) = token_res {
            #[derive(serde::Deserialize)]
            struct GhcrToken { token: String }
            if let Ok(token_obj) = res.json::<GhcrToken>().await {
                let manifest_url = format!("https://ghcr.io/v2/kral14/server-repo-rust/manifests/{}", version);
                let manifest_res = client.head(&manifest_url)
                    .header("User-Agent", "DeployMaster")
                    .header("Authorization", format!("Bearer {}", token_obj.token))
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
    
    if !check_success {
        let output = tokio::process::Command::new("docker")
            .args(["manifest", "inspect", &image])
            .output()
            .await;
            
        if let Ok(out) = output {
            if out.status.success() {
                check_success = true;
            }
        }
    }

    if !check_success {
        return Err((StatusCode::BAD_REQUEST, format!("'{}' versiyasına aid Docker imici GHCR reyestrində tapılmadı və ya hələ build olunur. Zəhmət olmasa 1-2 dəqiqə sonra yenidən cəhd edin.", version)));
    }

    let pull_res = tokio::process::Command::new("docker")
        .args(["pull", &image])
        .status()
        .await;

    match pull_res {
        Ok(status) if status.success() => {
            let inspect_output = tokio::process::Command::new("docker")
                .args(["inspect", "--format={{.Id}} {{range $p, $conf := .HostConfig.PortBindings}}{{(index $conf 0).HostPort}}{{end}}", "masterdeploy"])
                .output()
                .await;
            
            let mut current_image_id = String::new();
            let mut host_port = "3000".to_string();

            if let Ok(out) = inspect_output {
                if out.status.success() {
                    let out_str = String::from_utf8_lossy(&out.stdout);
                    let parts: Vec<&str> = out_str.trim().split_whitespace().collect();
                    if !parts.is_empty() {
                        current_image_id = parts[0].to_string();
                    }
                    if parts.len() > 1 && !parts[1].is_empty() {
                        host_port = parts[1].to_string();
                    }
                }
            }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_version_format() {
        let Json(val) = get_version().await;
        assert_eq!(val["name"], "DeployMaster");
        assert!(!val["version"].as_str().unwrap().is_empty());
    }
}
