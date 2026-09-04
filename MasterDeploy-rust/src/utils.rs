use sqlx::SqlitePool;
use uuid::Uuid;

pub async fn add_activity_log_pro(
    db: &SqlitePool,
    message: &str,
    log_type: &str,
    module: Option<&str>,
    operator_name: Option<&str>,
    target_id: Option<&str>,
    ip_address: Option<&str>,
) {
    let id = Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO activity_logs (id, message, log_type, module, operator_name, target_id, ip_address) \
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(message)
    .bind(log_type)
    .bind(module)
    .bind(operator_name)
    .bind(target_id)
    .bind(ip_address)
    .execute(db)
    .await;
}

pub fn format_github_repo_url(repo_url: &str, token: Option<&str>) -> String {
    let clean_url = if let Some(idx) = repo_url.find("@github.com/") {
        format!("https://github.com/{}", &repo_url[idx + "@github.com/".len()..])
    } else {
        repo_url.to_string()
    };

    if let Some(tok) = token {
        let tok = tok.trim();
        if !tok.is_empty() && clean_url.starts_with("https://github.com/") {
            return clean_url.replace("https://github.com/", &format!("https://x-access-token:{}@github.com/", tok));
        }
    }

    clean_url
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn test_add_activity_log() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory db");

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
            )"
        )
        .execute(&pool)
        .await
        .expect("Failed to create table");

        add_activity_log_pro(
            &pool,
            "Sistem testi uğurla keçdi",
            "info",
            Some("System"),
            Some("test_runner"),
            None,
            Some("127.0.0.1"),
        )
        .await;

        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM activity_logs")
            .fetch_one(&pool)
            .await
            .expect("Fetch failed");

        assert_eq!(row.0, 1);
    }
}
