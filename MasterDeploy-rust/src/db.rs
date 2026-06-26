use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::fs::File;
use std::path::Path;

pub async fn init_db() -> Result<SqlitePool, sqlx::Error> {
    let db_dir = "/app/data";
    let db_path = format!("{}/masterdeploy.db", db_dir);

    // Create directory if it doesn't exist
    std::fs::create_dir_all(db_dir).ok();
    
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
    let _ = sqlx::query("ALTER TABLE applications ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;").execute(&pool).await;

    Ok(pool)
}
