use axum::{
    routing::get,
    Router,
};
use sqlx::SqlitePool;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

pub mod applications;
pub mod db;
pub mod deploy;
pub mod git_watcher;
pub mod models;
pub mod plugins;
pub mod servers;
pub mod ssh;
pub mod system;
pub mod utils;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
}

pub async fn perform_docker_login(token: &str) {
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
    tokio::spawn(git_watcher::git_polling_loop(pool.clone()));

    let app = Router::new()
        .nest_service("/", ServeDir::new("static"))
        // Modulyar API marşrutları
        .nest("/api/servers", servers::servers_router())
        .nest("/api/ssh-keys", servers::ssh_keys_router())
        .nest("/api/applications", applications::applications_router())
        .nest("/api/deploy", deploy::deploy_router())
        .nest("/api/deployments", deploy::deployments_router())
        .route("/api/runtime-logs/:app_id", get(applications::get_runtime_logs))
        .nest("/api/plugins/cloudflare", Router::new()
            .route("/start/:app_id", axum::routing::post(plugins::cloudflare::start_cloudflare_tunnel))
            .route("/logs/:app_id", get(plugins::cloudflare::get_cloudflare_tunnel_logs))
            .route("/stop/:app_id", axum::routing::post(plugins::cloudflare::stop_cloudflare_tunnel))
            .route("/settings", get(plugins::cloudflare::get_cloudflare_settings).post(plugins::cloudflare::save_cloudflare_settings))
            .route("/check", get(plugins::cloudflare::check_cloudflare_connection))
            .route("/deploy-worker/:app_id", axum::routing::post(plugins::cloudflare::deploy_worker))
            .route("/delete-worker/:app_id", axum::routing::post(plugins::cloudflare::delete_worker))
        )
        .merge(plugins::router())
        .route("/api/version", get(system::get_version))
        .nest("/api/system", system::router())
        .nest("/api/settings", system::settings_router())
        .nest("/api/activity-logs", system::activity_logs_router())
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

async fn request_logger(
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    
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
