use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    SqlitePool,
};
use std::fs::File;
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;
use uuid::Uuid;

pub async fn init_db() -> Result<SqlitePool, sqlx::Error> {
    let db_path = if Path::new("/.dockerenv").exists() || (cfg!(target_family = "unix") && Path::new("/app/data").exists()) {
        let db_dir = "/app/data";
        std::fs::create_dir_all(db_dir).ok();
        format!("{}/masterdeploy.db", db_dir)
    } else {
        "masterdeploy.db".to_string()
    };

    // Create db file if it does not exist
    if !Path::new(&db_path).exists() {
        File::create(&db_path).ok();
    }

    let connect_options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Delete)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(30));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(connect_options)
        .await?;

    // 1. Run sqlx migrations automatically with detailed logging
    println!("[INFO] 🔍 Verilənlər bazası miqrasiyaları yoxlanılır...");
    match sqlx::migrate!("./migrations").run(&pool).await {
        Ok(_) => {
            println!("[SUCCESS] ✅ Bütün SQL miqrasiyaları uğurla tətbiq edildi (Multi-node plugins və Tunnels aktivdir).");
        }
        Err(e) => {
            eprintln!("[WARN] ⚠️ Verilənlər bazası miqrasiya bildirişi (safe fallback): {}", e);
        }
    }

    // 1.1 Təhlükəsiz fallback: Əgər miqrasiya faylı checksum xətası ilə atlansa belə cədvəllərin mövcudluğunu zəmanətə alırıq
    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS server_plugins (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            plugin_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'installed',
            config_json TEXT,
            installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(server_id, plugin_name)
        );"
    ).execute(&pool).await;

    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS tunnels (
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
    ).execute(&pool).await;

    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS tunnel_routes (
            id TEXT PRIMARY KEY,
            tunnel_id TEXT NOT NULL REFERENCES tunnels(id) ON DELETE CASCADE,
            app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
            target_port INTEGER NOT NULL,
            route_path TEXT NOT NULL DEFAULT '/',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(tunnel_id, app_id)
        );"
    ).execute(&pool).await;

    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS tunnel_link_history (
            id TEXT PRIMARY KEY,
            app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
            app_name TEXT NOT NULL,
            tunnel_id TEXT,
            previous_url TEXT,
            new_url TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expired_at DATETIME
        );"
    ).execute(&pool).await;

    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_tunnel_history_app ON tunnel_link_history(app_id)").execute(&pool).await;
    let _ = sqlx::query("CREATE INDEX IF NOT EXISTS idx_tunnel_history_assigned ON tunnel_link_history(assigned_at DESC)").execute(&pool).await;

    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN tunnel_id TEXT").execute(&pool).await;

    // Mövcud aktiv cloudflare_url-ləri ilkin tarixçə kimi qeyd edirik
    let _ = sqlx::query(
        "INSERT INTO tunnel_link_history (id, app_id, app_name, tunnel_id, previous_url, new_url, status, assigned_at) \
         SELECT lower(hex(randomblob(16))), a.id, a.name, a.tunnel_id, NULL, a.cloudflare_url, 'active', a.created_at \
         FROM applications a \
         WHERE a.cloudflare_url IS NOT NULL AND a.cloudflare_url != '' \
         AND NOT EXISTS (SELECT 1 FROM tunnel_link_history h WHERE h.app_id = a.id)"
    ).execute(&pool).await;

    println!("[INFO] 🌐 'server_plugins', 'tunnels', 'tunnel_routes', 'tunnel_link_history' sxemləri təsdiqləndi.");

    // Avtomatik sinxronizasiya: cloudflare_url olan amma tunnel_id olmayan tətbiqləri tünellər cədvəlinə daxil edirik
    if let Ok(unlinked_apps) = sqlx::query_as::<_, (String, String, String, i64, String)>(
        "SELECT id, name, server_id, port, cloudflare_url FROM applications WHERE cloudflare_url IS NOT NULL AND (tunnel_id IS NULL OR tunnel_id = '')"
    )
    .fetch_all(&pool)
    .await {
        for (a_id, a_name, s_id, port, cf_url) in unlinked_apps {
            let tunnel_name = format!("Tunel-{} (Dedicated)", a_name);
            let existing_tid: Option<String> = match sqlx::query_as::<_, (String,)>(
                "SELECT id FROM tunnels WHERE server_id = ? AND name = ?"
            )
            .bind(&s_id)
            .bind(&tunnel_name)
            .fetch_optional(&pool)
            .await {
                Ok(Some((tid,))) => {
                    let _ = sqlx::query("UPDATE tunnels SET public_url = ?, status = 'active' WHERE id = ?")
                        .bind(&cf_url)
                        .bind(&tid)
                        .execute(&pool)
                        .await;
                    Some(tid)
                }
                _ => None,
            };

            let tid = match existing_tid {
                Some(t) => t,
                None => {
                    let new_id = Uuid::new_v4().to_string();
                    let _ = sqlx::query(
                        "INSERT INTO tunnels (id, server_id, name, tunnel_type, public_url, status) VALUES (?, ?, ?, 'dedicated', ?, 'active')"
                    )
                    .bind(&new_id)
                    .bind(&s_id)
                    .bind(&tunnel_name)
                    .bind(&cf_url)
                    .execute(&pool)
                    .await;
                    new_id
                }
            };

            let route_id = Uuid::new_v4().to_string();
            let _ = sqlx::query(
                "INSERT INTO tunnel_routes (id, tunnel_id, app_id, target_port, route_path) VALUES (?, ?, ?, ?, '/') \
                 ON CONFLICT(tunnel_id, app_id) DO UPDATE SET target_port = excluded.target_port"
            )
            .bind(&route_id)
            .bind(&tid)
            .bind(&a_id)
            .bind(port)
            .execute(&pool)
            .await;

            let _ = sqlx::query("UPDATE applications SET tunnel_id = ? WHERE id = ?")
                .bind(&tid)
                .bind(&a_id)
                .execute(&pool)
                .await;
        }
    }


    // 2. Data Migration: Migrate existing ssh keys from servers.ssh_key to ssh_keys table
    // Fetch all servers that have a plain text ssh_key, but no ssh_key_id associated yet.
    let unmigrated_servers: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, name, ssh_key FROM servers WHERE ssh_key_id IS NULL AND ssh_key != 'local'"
    )
    .fetch_all(&pool)
    .await?;

    for (server_id, server_name, ssh_key_content) in unmigrated_servers {
        if !ssh_key_content.trim().is_empty() {
            let key_id = Uuid::new_v4().to_string();
            let key_name = format!("{}-key", server_name);
            let description = format!("Migrated key from server {}", server_name);

            // Insert into ssh_keys
            let _ = sqlx::query(
                "INSERT INTO ssh_keys (id, name, description, private_key) VALUES (?, ?, ?, ?)"
            )
            .bind(&key_id)
            .bind(&key_name)
            .bind(&description)
            .bind(&ssh_key_content)
            .execute(&pool)
            .await;

            // Update server link
            let _ = sqlx::query("UPDATE servers SET ssh_key_id = ? WHERE id = ?")
                .bind(&key_id)
                .bind(&server_id)
                .execute(&pool)
                .await;
        }
    }

    // Seed default local server if empty
    if let Ok(row_count) = sqlx::query_scalar::<_, i32>("SELECT COUNT(*) FROM servers").fetch_one(&pool).await {
        if row_count == 0 {
            let local_id = "local-server-id";
            let _ = sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, 'Local Host', 'local', 'local', 'local')")
                .bind(local_id)
                .execute(&pool)
                .await;
        }
    }

    // Restore correct server_id for applications that were misassigned to local/master server
    let _ = sqlx::query(
        "UPDATE applications SET server_id = (SELECT id FROM servers WHERE ip = '132.145.76.194') \
         WHERE (name = 'yeni-test' OR name = 'mezuniyyet-newapi') \
         AND server_id = 'local-server-id' \
         AND EXISTS (SELECT 1 FROM servers WHERE ip = '132.145.76.194')"
    )
    .execute(&pool)
    .await;

    // Restore empty ssh_key values using ssh_key_id from ssh_keys table
    let _ = sqlx::query(
        "UPDATE servers SET ssh_key = (SELECT private_key FROM ssh_keys WHERE ssh_keys.id = servers.ssh_key_id) \
         WHERE (ssh_key IS NULL OR ssh_key = '' OR ssh_key = '-' OR LENGTH(ssh_key) < 20) \
         AND ssh_key_id IS NOT NULL"
    )
    .execute(&pool)
    .await;

    // 3. Auto-Deploy ağıllı idarəetmə sütunlarının təhlükəsiz əlavə olunması
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN auto_deploy_enabled INTEGER DEFAULT 0").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN auto_deploy_interval INTEGER DEFAULT 15").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN auto_deploy_timeout INTEGER DEFAULT 10").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN last_auto_deploy_check DATETIME").execute(&pool).await;

    // 4. Qlobal sistem və arxa plan xidmətləri sazlamaları cədvəli
    let _ = sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )"
    ).execute(&pool).await;

    let _ = sqlx::query("INSERT OR IGNORE INTO settings (key, value) VALUES ('bg_autodeploy_enabled', '1')").execute(&pool).await;
    let _ = sqlx::query("INSERT OR IGNORE INTO settings (key, value) VALUES ('bg_autoclean_enabled', '1')").execute(&pool).await;
    let _ = sqlx::query("INSERT OR IGNORE INTO settings (key, value) VALUES ('bg_autoclean_days', '30')").execute(&pool).await;
    let _ = sqlx::query("INSERT OR IGNORE INTO settings (key, value) VALUES ('bg_tunnel_watchdog_enabled', '1')").execute(&pool).await;
    let _ = sqlx::query("INSERT OR IGNORE INTO settings (key, value) VALUES ('bg_tunnel_watchdog_interval', '2')").execute(&pool).await;

    Ok(pool)
}


