use sqlx::sqlite::SqlitePoolOptions;
use uuid::Uuid;

#[tokio::test]
async fn test_database_schema_and_tunnel_routes() {
    // 1. In-memory SQLite bazası yaradılır
    let pool = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .expect("In-memory SQLite-a qoşulmaq alınmadı");

    // 2. Miqrasiya cədvəllərini tətbiq edirik
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
            server_id TEXT NOT NULL,
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

    // 3. Test: Server və Plugin yaradılması
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

    // 4. Test: Ortaq Tünel A yaradılması
    let tunnel_a_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO tunnels (id, server_id, name, tunnel_type, status, public_url) VALUES (?, ?, 'Tunel-A', 'shared', 'active', 'https://test-a.trycloudflare.com')")
        .bind(&tunnel_a_id)
        .bind(&server_id)
        .execute(&pool)
        .await
        .unwrap();

    // 5. Test: Eyni Tünel A-ya 2 fərqli layihənin bağlanması (Shared Routing)
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

    // Yoxlama: Tunel A-ya bağlı marşrutların sayı 2 olmalıdır
    let routes_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tunnel_routes WHERE tunnel_id = ?")
        .bind(&tunnel_a_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(routes_count.0, 2, "Tunel A-ya 2 fərqli layihə marşrutu bağlanmış olmalıdır");

    // 6. Test: Ayrı (Dedicated) Tünel B yaradılması
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

    println!("🎉 Bütün verilənlər bazası və multi-tunnel marşrut testləri uğurla keçdi!");
}
