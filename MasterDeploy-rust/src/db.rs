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
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(15));

    let pool = SqlitePoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(connect_options)
        .await?;

    // 1. Run sqlx migrations automatically
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await?;

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

    Ok(pool)
}

