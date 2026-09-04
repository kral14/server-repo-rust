use sqlx::SqlitePool;
use uuid::Uuid;

async fn setup_test_db() -> SqlitePool {
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

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

    pool
}

#[tokio::test]
async fn test_server_creation_and_duplicate_ip_check() {
    let pool = setup_test_db().await;

    let server_id = Uuid::new_v4().to_string();
    let server_ip = "192.168.1.100";

    // 1. Yeni server əlavə edilir
    let res = sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key) VALUES (?, ?, ?, ?, ?)")
        .bind(&server_id)
        .bind("Primary Node")
        .bind(server_ip)
        .bind("root")
        .bind("dummy_key")
        .execute(&pool)
        .await;
    assert!(res.is_ok());

    // 2. Eyni IP təkrar yoxlanışı
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM servers WHERE ip = ?")
        .bind(server_ip)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(exists.is_some());
    assert_eq!(exists.unwrap().0, server_id);

    // 3. Fərqli IP-nin mövcud olmaması
    let not_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM servers WHERE ip = ?")
        .bind("192.168.1.101")
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(not_exists.is_none());
}

#[tokio::test]
async fn test_ssh_key_deletion_protection_when_in_use() {
    let pool = setup_test_db().await;

    let key_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO ssh_keys (id, name, private_key) VALUES (?, ?, ?)")
        .bind(&key_id)
        .bind("Production Key")
        .bind("-----BEGIN OPENSSH PRIVATE KEY-----")
        .execute(&pool)
        .await
        .unwrap();

    let server_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO servers (id, name, ip, ssh_user, ssh_key, ssh_key_id) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&server_id)
        .bind("Cloud Node")
        .bind("10.0.0.5")
        .bind("ubuntu")
        .bind("local")
        .bind(&key_id)
        .execute(&pool)
        .await
        .unwrap();

    // Açarın hər hansı serverdə işləndiyini yoxlamaq
    let in_use: Option<(String, String)> = sqlx::query_as("SELECT name, ip FROM servers WHERE ssh_key_id = ? LIMIT 1")
        .bind(&key_id)
        .fetch_optional(&pool)
        .await
        .unwrap();

    assert!(in_use.is_some());
    let (name, ip) = in_use.unwrap();
    assert_eq!(name, "Cloud Node");
    assert_eq!(ip, "10.0.0.5");
}
