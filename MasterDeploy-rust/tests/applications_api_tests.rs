use sqlx::SqlitePool;
use uuid::Uuid;

async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

    sqlx::query(
        "CREATE TABLE applications (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            repo_url TEXT NOT NULL,
            branch TEXT NOT NULL,
            port INTEGER NOT NULL,
            server_id TEXT NOT NULL,
            status TEXT NOT NULL,
            env_vars TEXT,
            build_pack_type TEXT,
            build_command TEXT,
            run_command TEXT,
            dockerfile_path TEXT,
            entrypoint TEXT,
            command TEXT,
            target TEXT,
            work_dir TEXT,
            privileged INTEGER DEFAULT 0,
            memory_limit TEXT,
            cpu_limit REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_commit_hash TEXT,
            cloudflare_url TEXT,
            cf_worker_url TEXT,
            deploy_type TEXT,
            registry_image TEXT,
            auto_deploy_enabled INTEGER DEFAULT 0,
            auto_deploy_interval INTEGER DEFAULT 15,
            auto_deploy_timeout INTEGER DEFAULT 10,
            last_auto_deploy_check DATETIME
        );"
    ).execute(&pool).await.unwrap();

    pool
}

#[tokio::test]
async fn test_application_lifecycle_and_auto_deploy_defaults() {
    let pool = setup_test_db().await;

    let app_id = Uuid::new_v4().to_string();
    let bp_type = "dockerfile";
    let dep_type = "git";
    let auto_enabled = 1;
    let auto_interval = 15;
    let auto_timeout = 10;

    sqlx::query(
        "INSERT INTO applications (
            id, name, repo_url, branch, port, server_id, status,
            build_pack_type, deploy_type,
            auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&app_id)
    .bind("my-web-service")
    .bind("https://github.com/test/repo")
    .bind("main")
    .bind(8080)
    .bind("server-1")
    .bind("stopped")
    .bind(bp_type)
    .bind(dep_type)
    .bind(auto_enabled)
    .bind(auto_interval)
    .bind(auto_timeout)
    .execute(&pool)
    .await
    .unwrap();

    let row: (String, String, i64, String, i64, i64) = sqlx::query_as(
        "SELECT id, name, port, status, auto_deploy_enabled, auto_deploy_interval FROM applications WHERE id = ?"
    )
    .bind(&app_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, app_id);
    assert_eq!(row.1, "my-web-service");
    assert_eq!(row.2, 8080);
    assert_eq!(row.3, "stopped");
    assert_eq!(row.4, 1);
    assert_eq!(row.5, 15);

    // Status yenilənməsi
    sqlx::query("UPDATE applications SET status = 'running' WHERE id = ?")
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    let updated_status: String = sqlx::query_scalar("SELECT status FROM applications WHERE id = ?")
        .bind(&app_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(updated_status, "running");
}

#[tokio::test]
async fn test_autodeploy_center_listing_and_quick_toggle() {
    let pool = setup_test_db().await;

    // Normal app
    let app1_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO applications (id, name, repo_url, branch, port, server_id, status, auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout)
         VALUES (?, 'regular-app', 'https://github.com/test/reg', 'main', 8080, 'srv1', 'running', 1, 15, 10)"
    )
    .bind(&app1_id)
    .execute(&pool).await.unwrap();

    // Watchdog system service
    let app2_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO applications (id, name, repo_url, branch, port, server_id, status, deploy_type, registry_image, auto_deploy_enabled, auto_deploy_interval, auto_deploy_timeout)
         VALUES (?, 'masterdeploy-watchdog', '', 'main', 8082, 'local', 'running', 'image', 'masterdeploy-watchdog', 0, 30, 15)"
    )
    .bind(&app2_id)
    .execute(&pool).await.unwrap();

    // 1. Auto-deploy mərkəzində hər iki tətbiq (həm adi, həm watchdog) siyahılanmalıdır
    let rows: Vec<(String, String, i64, i64)> = sqlx::query_as(
        "SELECT id, name, auto_deploy_enabled, auto_deploy_interval FROM applications WHERE name NOT LIKE 'cf-tunnel-%' ORDER BY auto_deploy_enabled DESC"
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].1, "regular-app");
    assert_eq!(rows[0].2, 1);
    assert_eq!(rows[1].1, "masterdeploy-watchdog");
    assert_eq!(rows[1].2, 0);

    // 2. Quick toggle və interval yenilənməsi
    sqlx::query("UPDATE applications SET auto_deploy_enabled = 1, auto_deploy_interval = 5 WHERE id = ?")
        .bind(&app2_id)
        .execute(&pool)
        .await
        .unwrap();

    let watchdog_state: (i64, i64) = sqlx::query_as("SELECT auto_deploy_enabled, auto_deploy_interval FROM applications WHERE id = ?")
        .bind(&app2_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(watchdog_state.0, 1);
    assert_eq!(watchdog_state.1, 5);
}
