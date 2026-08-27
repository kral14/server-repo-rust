use sqlx::SqlitePool;
use uuid::Uuid;

#[tokio::test]
async fn test_activity_logging_pro() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

    sqlx::query(
        "CREATE TABLE activity_logs (
            id TEXT PRIMARY KEY,
            message TEXT NOT NULL,
            log_type TEXT NOT NULL,
            module TEXT,
            operator_name TEXT,
            target_id TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    let log_id = Uuid::new_v4().to_string();
    let message = "Test auto-deploy system updated";
    let log_type = "success";
    let module = Some("Git");
    let operator_name = Some("system");
    let target_id = Some("test-app-123");
    let ip_address = Some("127.0.0.1");

    sqlx::query(
        "INSERT INTO activity_logs (id, message, log_type, module, operator_name, target_id, ip_address) \
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&log_id)
    .bind(message)
    .bind(log_type)
    .bind(module)
    .bind(operator_name)
    .bind(target_id)
    .bind(ip_address)
    .execute(&pool)
    .await
    .unwrap();

    let row: (String, String, String, Option<String>, Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT id, message, log_type, module, operator_name, target_id, ip_address FROM activity_logs WHERE id = ?"
    )
    .bind(&log_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, log_id);
    assert_eq!(row.1, message);
    assert_eq!(row.2, log_type);
    assert_eq!(row.3, Some("Git".to_string()));
    assert_eq!(row.4, Some("system".to_string()));
    assert_eq!(row.5, Some("test-app-123".to_string()));
    assert_eq!(row.6, Some("127.0.0.1".to_string()));
}
