use sqlx::SqlitePool;
use uuid::Uuid;

async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

    sqlx::query(
        "CREATE TABLE deployments (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL,
            status TEXT NOT NULL,
            logs TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE applications (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL
        );"
    ).execute(&pool).await.unwrap();

    pool
}

#[tokio::test]
async fn test_deployment_lifecycle_and_cancellation() {
    let pool = setup_test_db().await;

    let app_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO applications (id, name, status) VALUES (?, ?, ?)")
        .bind(&app_id)
        .bind("service-alpha")
        .bind("deploying")
        .execute(&pool)
        .await
        .unwrap();

    let dep_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO deployments (id, application_id, status, logs) VALUES (?, ?, ?, ?)")
        .bind(&dep_id)
        .bind(&app_id)
        .bind("building")
        .bind("Initial log message\n")
        .execute(&pool)
        .await
        .unwrap();

    // 1. Status yoxlanışı
    let status: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id = ?")
        .bind(&dep_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "building");

    // 2. Loqların yenilənməsi
    sqlx::query("UPDATE deployments SET logs = logs || ? WHERE id = ?")
        .bind("Docker build succeeded\n")
        .bind(&dep_id)
        .execute(&pool)
        .await
        .unwrap();

    let logs: String = sqlx::query_scalar("SELECT logs FROM deployments WHERE id = ?")
        .bind(&dep_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(logs.contains("Docker build succeeded"));

    // 3. Ləğv etmə (Cancellation)
    sqlx::query("UPDATE deployments SET status = 'cancelled' WHERE id = ?")
        .bind(&dep_id)
        .execute(&pool)
        .await
        .unwrap();

    let cancelled_status: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id = ?")
        .bind(&dep_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cancelled_status, "cancelled");
}
