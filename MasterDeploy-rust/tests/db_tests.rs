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

#[tokio::test]
async fn test_ssh_keys_management_crud() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();

    sqlx::query(
        "CREATE TABLE ssh_keys (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            private_key TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            ip TEXT NOT NULL,
            ssh_user TEXT NOT NULL,
            ssh_key TEXT NOT NULL,
            ssh_key_id TEXT REFERENCES ssh_keys(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    let key_id = Uuid::new_v4().to_string();
    let key_name = "Test-Key-Oracle";
    let key_desc = Some("Oracle Cloud private key".to_string());
    let private_key = "---BEGIN OPENSSH PRIVATE KEY---";

    sqlx::query("INSERT INTO ssh_keys (id, name, description, private_key) VALUES (?, ?, ?, ?)")
        .bind(&key_id)
        .bind(key_name)
        .bind(&key_desc)
        .bind(private_key)
        .execute(&pool)
        .await
        .unwrap();

    let key_row: (String, String, Option<String>) = sqlx::query_as(
        "SELECT id, name, description FROM ssh_keys WHERE id = ?"
    )
    .bind(&key_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(key_row.0, key_id);
    assert_eq!(key_row.1, key_name);
    assert_eq!(key_row.2, key_desc);

    let server_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key, ssh_key_id) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&server_id)
        .bind("Oracle-VM-1")
        .bind("132.145.76.194")
        .bind("ubuntu")
        .bind("local")
        .bind(&key_id)
        .execute(&pool)
        .await
        .unwrap();

    let used_servers: Option<String> = sqlx::query_scalar(
        "SELECT (SELECT GROUP_CONCAT(s.name, ', ') FROM servers s WHERE s.ssh_key_id = k.id) FROM ssh_keys k WHERE k.id = ?"
    )
    .bind(&key_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(used_servers, Some("Oracle-VM-1".to_string()));
}
