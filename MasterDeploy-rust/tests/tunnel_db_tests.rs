use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use uuid::Uuid;

async fn setup_tunnel_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .expect("In-memory SQLite-a qoşulmaq alınmadı");

    sqlx::query("PRAGMA foreign_keys = ON;").execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            ip TEXT NOT NULL,
            ssh_user TEXT NOT NULL,
            ssh_key TEXT NOT NULL,
            ssh_key_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE applications (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            repo_url TEXT NOT NULL,
            branch TEXT NOT NULL,
            port INTEGER NOT NULL,
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE server_plugins (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            plugin_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'installed',
            config_json TEXT,
            installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(server_id, plugin_name)
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE tunnels (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            tunnel_type TEXT NOT NULL DEFAULT 'dedicated',
            public_url TEXT,
            status TEXT NOT NULL DEFAULT 'stopped',
            last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(server_id, name)
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE tunnel_routes (
            id TEXT PRIMARY KEY,
            tunnel_id TEXT NOT NULL REFERENCES tunnels(id) ON DELETE CASCADE,
            app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
            target_port INTEGER NOT NULL,
            route_path TEXT NOT NULL DEFAULT '/',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tunnel_id, app_id)
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE tunnel_link_history (
            id TEXT PRIMARY KEY,
            app_id TEXT,
            app_name TEXT,
            tunnel_id TEXT,
            previous_url TEXT,
            new_url TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expired_at DATETIME
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );"
    ).execute(&pool).await.unwrap();

    pool
}

#[tokio::test]
async fn test_database_schema_and_tunnel_routes() {
    let pool = setup_tunnel_test_db().await;

    let server_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, 'Oracle-VM-1', '132.145.76.194', 'ubuntu', 'key')")
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let plugin_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO server_plugins (id, server_id, plugin_name, status) VALUES (?, ?, 'cloudflare', 'installed')")
        .bind(&plugin_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let plugin_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM server_plugins WHERE server_id = ? AND plugin_name = 'cloudflare'")
        .bind(&server_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(plugin_count.0, 1, "Server plugin uğurla quraşdırılmalıdır");

    // Ortaq Tünel A yaradılması
    let tunnel_a_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO tunnels (id, server_id, name, tunnel_type, status, public_url) VALUES (?, ?, 'Tunel-A', 'shared', 'active', 'https://test-a.trycloudflare.com')")
        .bind(&tunnel_a_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    // Eyni Tünel A-ya 2 fərqli layihənin bağlanması (Shared Routing)
    let app1_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO applications (id, name, repo_url, branch, port, server_id, status) VALUES (?, 'mezuniyyet-api', 'url', 'main', 8080, ?, 'running')")
        .bind(&app1_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let app2_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO applications (id, name, repo_url, branch, port, server_id, status) VALUES (?, 'crm-api', 'url', 'main', 3001, ?, 'running')")
        .bind(&app2_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    // App 1 -> Tunel A (Port 8080)
    let route1_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO tunnel_routes (id, tunnel_id, app_id, target_port, route_path) VALUES (?, ?, ?, 8080, '/mezuniyyet')")
        .bind(&route1_id)
        .bind(&tunnel_a_id)
        .bind(&app1_id)
        .execute(&pool)
        .await
        .unwrap();

    // App 2 -> Tunel A (Port 3001)
    let route2_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO tunnel_routes (id, tunnel_id, app_id, target_port, route_path) VALUES (?, ?, ?, 3001, '/crm')")
        .bind(&route2_id)
        .bind(&tunnel_a_id)
        .bind(&app2_id)
        .execute(&pool)
        .await
        .unwrap();

    let routes_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tunnel_routes WHERE tunnel_id = ?")
        .bind(&tunnel_a_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(routes_count.0, 2, "Tunel A-ya 2 fərqli layihə marşrutu bağlanmış olmalıdır");

    // Ayrı (Dedicated) Tünel B yaradılması
    let tunnel_b_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO tunnels (id, server_id, name, tunnel_type, status, public_url) VALUES (?, ?, 'Tunel-B', 'dedicated', 'active', 'https://test-b.trycloudflare.com')")
        .bind(&tunnel_b_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let tunnel_b_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tunnels WHERE server_id = ?")
        .bind(&server_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tunnel_b_count.0, 2, "Həmin serverdə həm Tunel-A, həm Tunel-B müstəqil mövcud olmalıdır");
}

#[tokio::test]
async fn test_duplicate_tunnel_name_constraint_rejection() {
    let pool = setup_tunnel_test_db().await;

    let server_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, 'Node-1', '10.0.0.1', 'root', 'k')")
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let t1_id = Uuid::new_v4().to_string();
    let res1 = sqlx::query("INSERT INTO tunnels (id, server_id, name, tunnel_type) VALUES (?, ?, 'Shared-A', 'shared')")
        .bind(&t1_id)
        .bind(&server_id)
        .execute(&pool)
        .await;
    assert!(res1.is_ok(), "İlk tünel uğurla əlavə olunmalıdır");

    // Eyni serverdə eyni adlı 'Shared-A' tüneli əlavə edilməyə çalışıldıqda UNIQUE ziddiyyəti yaranmalıdır
    let t2_id = Uuid::new_v4().to_string();
    let res2 = sqlx::query("INSERT INTO tunnels (id, server_id, name, tunnel_type) VALUES (?, ?, 'Shared-A', 'dedicated')")
        .bind(&t2_id)
        .bind(&server_id)
        .execute(&pool)
        .await;
    assert!(res2.is_err(), "Eyni serverdə eyni adlı tünel yaradılması rədd edilməlidir");

    // Lakin fərqli serverdə eyni adlı tünel yaradıla bilər
    let server_id_2 = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, 'Node-2', '10.0.0.2', 'root', 'k')")
        .bind(&server_id_2)
        .execute(&pool)
        .await
        .unwrap();

    let t3_id = Uuid::new_v4().to_string();
    let res3 = sqlx::query("INSERT INTO tunnels (id, server_id, name, tunnel_type) VALUES (?, ?, 'Shared-A', 'shared')")
        .bind(&t3_id)
        .bind(&server_id_2)
        .execute(&pool)
        .await;
    assert!(res3.is_ok(), "Fərqli serverdə eyni adla tünel yaratmaq mümkün olmalıdır");
}

#[tokio::test]
async fn test_duplicate_app_route_on_same_tunnel_rejection() {
    let pool = setup_tunnel_test_db().await;

    let server_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, 'Node-1', '10.0.0.1', 'root', 'k')")
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let tunnel_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO tunnels (id, server_id, name, tunnel_type) VALUES (?, ?, 'Main-Tunnel', 'shared')")
        .bind(&tunnel_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let app_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO applications (id, name, repo_url, branch, port, server_id, status) VALUES (?, 'web-service', 'url', 'main', 8080, ?, 'running')")
        .bind(&app_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    // 1-ci marşrut əlavə edilir
    let r1_id = Uuid::new_v4().to_string();
    let res1 = sqlx::query("INSERT INTO tunnel_routes (id, tunnel_id, app_id, target_port, route_path) VALUES (?, ?, ?, 8080, '/')")
        .bind(&r1_id)
        .bind(&tunnel_id)
        .bind(&app_id)
        .execute(&pool)
        .await;
    assert!(res1.is_ok(), "İlk marşrut bağlanmalıdır");

    // Eyni layihəni eyni tünelə təkrar bağlamaq UNIQUE(tunnel_id, app_id) ilə qadağan olunmalıdır
    let r2_id = Uuid::new_v4().to_string();
    let res2 = sqlx::query("INSERT INTO tunnel_routes (id, tunnel_id, app_id, target_port, route_path) VALUES (?, ?, ?, 8080, '/duplicate')")
        .bind(&r2_id)
        .bind(&tunnel_id)
        .bind(&app_id)
        .execute(&pool)
        .await;
    assert!(res2.is_err(), "Eyni tətbiqin eyni tünelə dublikat marşrutlanması rədd edilməlidir");
}

#[tokio::test]
async fn test_foreign_key_cascade_deletion() {
    let pool = setup_tunnel_test_db().await;

    let server_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, 'Node-Cascade', '10.0.0.5', 'root', 'k')")
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let tunnel_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO tunnels (id, server_id, name, tunnel_type) VALUES (?, ?, 'Cascade-Tunnel', 'shared')")
        .bind(&tunnel_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let app_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO applications (id, name, repo_url, branch, port, server_id, status) VALUES (?, 'cascade-app', 'url', 'main', 4000, ?, 'running')")
        .bind(&app_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let r_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO tunnel_routes (id, tunnel_id, app_id, target_port, route_path) VALUES (?, ?, ?, 4000, '/')")
        .bind(&r_id)
        .bind(&tunnel_id)
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    // Əvvəlcə tünel silinəndə marşrutun avtomatik silinməsini yoxlayırıq
    sqlx::query("DELETE FROM tunnels WHERE id = ?")
        .bind(&tunnel_id)
        .execute(&pool)
        .await
        .unwrap();

    let count_routes: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tunnel_routes WHERE tunnel_id = ?")
        .bind(&tunnel_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_routes.0, 0, "Tünel silindikdə ona bağlı bütün marşrutlar CASCADE ilə silinməlidir");

    // Server silinəndə bağlı proqramların avtomatik silinməsi
    sqlx::query("DELETE FROM servers WHERE id = ?")
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let count_apps: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM applications WHERE server_id = ?")
        .bind(&server_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_apps.0, 0, "Server silindikdə onun proqramları CASCADE ilə silinməlidir");
}

#[tokio::test]
async fn test_tunnel_link_history_logging_and_retrieval() {
    let pool = setup_tunnel_test_db().await;

    let app_id = Uuid::new_v4().to_string();
    let tunnel_id = Uuid::new_v4().to_string();

    // 1-ci link qeydiyyatı
    let h1_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO tunnel_link_history (id, app_id, app_name, tunnel_id, previous_url, new_url, status) \
         VALUES (?, ?, 'mezuniyyet-api', ?, NULL, 'https://link-v1.trycloudflare.com', 'expired')"
    )
    .bind(&h1_id)
    .bind(&app_id)
    .bind(&tunnel_id)
    .execute(&pool)
    .await
    .unwrap();

    // 2-ci yenilənmiş link qeydiyyatı
    let h2_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO tunnel_link_history (id, app_id, app_name, tunnel_id, previous_url, new_url, status) \
         VALUES (?, ?, 'mezuniyyet-api', ?, 'https://link-v1.trycloudflare.com', 'https://link-v2.trycloudflare.com', 'active')"
    )
    .bind(&h2_id)
    .bind(&app_id)
    .bind(&tunnel_id)
    .execute(&pool)
    .await
    .unwrap();

    let active_link: (String, String) = sqlx::query_as(
        "SELECT previous_url, new_url FROM tunnel_link_history WHERE app_id = ? AND status = 'active'"
    )
    .bind(&app_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(active_link.0, "https://link-v1.trycloudflare.com");
    assert_eq!(active_link.1, "https://link-v2.trycloudflare.com");
}

#[tokio::test]
async fn test_server_plugin_scoped_and_conflict_update() {
    let pool = setup_tunnel_test_db().await;

    let server_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, 'Node-1', '10.0.0.1', 'root', 'k')")
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    let p_id1 = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO server_plugins (id, server_id, plugin_name, status, config_json) \
         VALUES (?, ?, 'cloudflare', 'installed', '{\"token\": \"abc\"}')"
    )
    .bind(&p_id1)
    .bind(&server_id)
    .execute(&pool)
    .await
    .unwrap();

    // Təkrar quraşdırılma zamanı ON CONFLICT DO UPDATE işləməlidir
    let p_id2 = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO server_plugins (id, server_id, plugin_name, status, config_json) \
         VALUES (?, ?, 'cloudflare', 'installed', '{\"token\": \"updated_token\"}') \
         ON CONFLICT(server_id, plugin_name) DO UPDATE SET config_json = excluded.config_json, updated_at = CURRENT_TIMESTAMP"
    )
    .bind(&p_id2)
    .bind(&server_id)
    .execute(&pool)
    .await
    .unwrap();

    let updated_config: (String,) = sqlx::query_as("SELECT config_json FROM server_plugins WHERE server_id = ? AND plugin_name = 'cloudflare'")
        .bind(&server_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert!(updated_config.0.contains("updated_token"), "Plugin konfiqurasiyası ON CONFLICT zamanı uğurla yenilənməlidir");
}

#[test]
fn test_remote_daemon_config_json_schema() {
    let cf_token = "secret_cf_token_123";
    let cf_account = "cf_account_456";
    let cf_kv = "cf_kv_namespace_789";

    let config = serde_json::json!({
        "cloudflare": {
            "api_token": cf_token,
            "account_id": cf_account,
            "kv_id": cf_kv
        },
        "tunnels": [
            {
                "id": "tun-001",
                "name": "Tunel-A",
                "tunnel_type": "shared",
                "target_port": 8080,
                "app_keys": ["mezuniyyet-api", "crm-api"]
            },
            {
                "id": "tun-002",
                "name": "Tunel-B",
                "tunnel_type": "dedicated",
                "target_port": 5000,
                "app_keys": ["auth-service"]
            }
        ]
    });

    assert_eq!(config["cloudflare"]["api_token"], cf_token);
    assert_eq!(config["tunnels"].as_array().unwrap().len(), 2);
    assert_eq!(config["tunnels"][0]["app_keys"][0], "mezuniyyet-api");
    assert_eq!(config["tunnels"][0]["app_keys"][1], "crm-api");
    assert_eq!(config["tunnels"][1]["tunnel_type"], "dedicated");
}
