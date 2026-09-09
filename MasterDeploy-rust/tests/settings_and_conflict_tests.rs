use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use uuid::Uuid;

async fn setup_conflict_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .expect("In-memory SQLite pool yaradılmadı");

    sqlx::query("PRAGMA foreign_keys = ON;").execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE applications (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            repo_url TEXT NOT NULL DEFAULT '',
            branch TEXT NOT NULL DEFAULT 'main',
            port INTEGER NOT NULL DEFAULT 8080,
            server_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'stopped',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE deployments (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
            status TEXT NOT NULL,
            logs TEXT NOT NULL DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    pool
}

#[tokio::test]
async fn test_settings_kv_store_crud_and_fallbacks() {
    let pool = setup_conflict_test_db().await;

    // 1. Ayar yoxdursa default dəyər qaytarılması
    let cf_token: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_api_token'")
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert_eq!(cf_token.as_deref().unwrap_or("default_token"), "default_token");

    // 2. Ayarın yazılması
    sqlx::query("INSERT INTO settings (key, value) VALUES ('cf_api_token', 'token_12345')")
        .execute(&pool)
        .await
        .unwrap();

    let fetched: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_api_token'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fetched, "token_12345");

    // 3. Ayarın yenilənməsi (UPSERT)
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('cf_api_token', 'token_updated_999') \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .execute(&pool)
    .await
    .unwrap();

    let updated: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'cf_api_token'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(updated, "token_updated_999");
}

#[tokio::test]
async fn test_concurrent_deployment_cancels_previous_building_deployments() {
    let pool = setup_conflict_test_db().await;

    let app_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO applications (id, name) VALUES (?, 'payment-api')")
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    // 1. Əvvəlki 3 deployment:
    // - dep1: 'building' (ləğv edilməlidir)
    // - dep2: 'deploying' (ləğv edilməlidir)
    // - dep3: 'success' (toxunulmamalıdır)
    let dep1_id = Uuid::new_v4().to_string();
    let dep2_id = Uuid::new_v4().to_string();
    let dep3_id = Uuid::new_v4().to_string();

    sqlx::query("INSERT INTO deployments (id, application_id, status) VALUES (?, ?, 'building')")
        .bind(&dep1_id)
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO deployments (id, application_id, status) VALUES (?, ?, 'deploying')")
        .bind(&dep2_id)
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO deployments (id, application_id, status) VALUES (?, ?, 'success')")
        .bind(&dep3_id)
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    // 2. deploy.rs-dəki kimi yeni deployment trigger edilir və əvvəlki in-flight proseslər ləğv edilir
    sqlx::query("UPDATE deployments SET status = 'cancelled' WHERE application_id = ? AND (status = 'building' OR status = 'deploying')")
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    // 3. Yoxlama
    let status1: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id = ?").bind(&dep1_id).fetch_one(&pool).await.unwrap();
    let status2: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id = ?").bind(&dep2_id).fetch_one(&pool).await.unwrap();
    let status3: String = sqlx::query_scalar("SELECT status FROM deployments WHERE id = ?").bind(&dep3_id).fetch_one(&pool).await.unwrap();

    assert_eq!(status1, "cancelled", "Aktiv 'building' statusu 'cancelled' olmalıdır");
    assert_eq!(status2, "cancelled", "Aktiv 'deploying' statusu 'cancelled' olmalıdır");
    assert_eq!(status3, "success", "Tamamlanmış 'success' deployment dəyişməməlidir");
}

#[tokio::test]
async fn test_applications_system_containers_filtering() {
    let pool = setup_conflict_test_db().await;

    // Daxili sistem konteynerləri və normal layihələr əlavə edilir
    sqlx::query("INSERT INTO applications (id, name) VALUES (?, 'cf-tunnel-internal-1')")
        .bind(Uuid::new_v4().to_string())
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO applications (id, name) VALUES (?, 'masterdeploy-updater-job')")
        .bind(Uuid::new_v4().to_string())
        .execute(&pool)
        .await
        .unwrap();

    let user_app_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO applications (id, name) VALUES (?, 'real-user-dashboard')")
        .bind(&user_app_id)
        .execute(&pool)
        .await
        .unwrap();

    // applications.rs-dəki süzgəc sorğusu
    let visible_apps: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM applications \
         WHERE name NOT LIKE 'cf-tunnel-%' AND name NOT LIKE 'masterdeploy-%' AND TRIM(name) != ''"
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(visible_apps.len(), 1, "Yalnız istifadəçiyə aid layihələr görünməlidir");
    assert_eq!(visible_apps[0], "real-user-dashboard");
}

#[tokio::test]
async fn test_application_deletion_cascades_deployments() {
    let pool = setup_conflict_test_db().await;

    let app_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO applications (id, name) VALUES (?, 'temp-app')")
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    let dep_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO deployments (id, application_id, status) VALUES (?, ?, 'failed')")
        .bind(&dep_id)
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    // Tətbiqi silirik
    sqlx::query("DELETE FROM applications WHERE id = ?")
        .bind(&app_id)
        .execute(&pool)
        .await
        .unwrap();

    let remaining_deps: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM deployments WHERE application_id = ?")
        .bind(&app_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(remaining_deps.0, 0, "Tətbiq silindikdə onun bütün köhnə deploymentləri avtomatik silinməlidir");
}
