use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::fs::File;
use std::path::Path;

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

    
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&format!("sqlite:{}", db_path))
        .await?;
        
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS servers (\n\
            id TEXT PRIMARY KEY,\n\
            name TEXT NOT NULL,\n\
            ip TEXT NOT NULL,\n\
            ssh_user TEXT NOT NULL,\n\
            ssh_key TEXT NOT NULL,\n\
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n\
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP\n\
        );"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS applications (\n\
            id TEXT PRIMARY KEY,\n\
            name TEXT NOT NULL,\n\
            repo_url TEXT NOT NULL,\n\
            branch TEXT NOT NULL,\n\
            port INTEGER NOT NULL,\n\
            server_id TEXT NOT NULL,\n\
            status TEXT NOT NULL,\n\
            env_vars TEXT,\n\
            build_pack_type TEXT DEFAULT 'dockerfile',\n\
            build_command TEXT,\n\
            run_command TEXT,\n\
            dockerfile_path TEXT,\n\
            entrypoint TEXT,\n\
            command TEXT,\n\
            target TEXT,\n\
            work_dir TEXT,\n\
            privileged INTEGER DEFAULT 0,\n\
            memory_limit TEXT,\n\
            cpu_limit REAL,\n\
            cloudflare_url TEXT,\n\
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n\
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n\
            FOREIGN KEY(server_id) REFERENCES servers(id)\n\
        );"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS deployments (\n\
            id TEXT PRIMARY KEY,\n\
            application_id TEXT NOT NULL,\n\
            status TEXT NOT NULL,\n\
            logs TEXT NOT NULL,\n\
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n\
            FOREIGN KEY(application_id) REFERENCES applications(id)\n\
        );"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (\n\
            key TEXT PRIMARY KEY,\n\
            value TEXT NOT NULL\n\
        );"
    ).execute(&pool).await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS activity_logs (\n\
            id TEXT PRIMARY KEY,\n\
            message TEXT NOT NULL,\n\
            log_type TEXT NOT NULL,\n\
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP\n\
        );"
    ).execute(&pool).await?;

    // Auto-migrate: Add columns if they do not exist (for existing databases)
    let _ = sqlx::query("ALTER TABLE servers ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN env_vars TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN build_pack_type TEXT DEFAULT 'dockerfile';").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN build_command TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN run_command TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN dockerfile_path TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN entrypoint TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN command TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN target TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN work_dir TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN privileged INTEGER DEFAULT 0;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN memory_limit TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN cpu_limit REAL;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN last_commit_hash TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN cloudflare_url TEXT;").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN cf_worker_url TEXT;").execute(&pool).await;
    if let Err(e) = sqlx::query("ALTER TABLE applications ADD COLUMN deploy_type TEXT DEFAULT 'git';").execute(&pool).await {
        println!("[DB-MIGRATE] deploy_type alter table status/error: {:?}", e);
    }
    if let Err(e) = sqlx::query("ALTER TABLE applications ADD COLUMN registry_image TEXT;").execute(&pool).await {
        println!("[DB-MIGRATE] registry_image alter table status/error: {:?}", e);
    }
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;").execute(&pool).await;

    // Seed default local server if empty
    if let Ok(row_count) = sqlx::query_scalar::<_, i32>("SELECT COUNT(*) FROM servers").fetch_one(&pool).await {
        if row_count == 0 {
            let local_id = "local-server-id"; // Constant ID or generated UUID
            let _ = sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, 'Local Host', 'local', 'local', 'local')")
                .bind(local_id)
                .execute(&pool)
                .await;
        }
    }

    // Auto-purge orphan applications and deployments whose server_id does not exist in servers table
    let _ = sqlx::query("DELETE FROM applications WHERE server_id NOT IN (SELECT id FROM servers)").execute(&pool).await;
    let _ = sqlx::query("DELETE FROM deployments WHERE application_id NOT IN (SELECT id FROM applications)").execute(&pool).await;

    Ok(pool)
}
