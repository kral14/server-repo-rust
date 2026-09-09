use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use uuid::Uuid;

async fn setup_watcher_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .expect("In-memory SQLite pool yaradılmadı");

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
            status TEXT NOT NULL DEFAULT 'running',
            auto_deploy_enabled INTEGER DEFAULT 0,
            auto_deploy_interval INTEGER DEFAULT 15,
            auto_deploy_timeout INTEGER DEFAULT 10,
            last_auto_deploy_check DATETIME,
            cloudflare_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    sqlx::query(
        "CREATE TABLE deployments (
            id TEXT PRIMARY KEY,
            application_id TEXT NOT NULL,
            status TEXT NOT NULL,
            logs TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).execute(&pool).await.unwrap();

    pool
}

#[tokio::test]
async fn test_autoclean_old_deployments_retention() {
    let pool = setup_watcher_test_db().await;

    let app_id = Uuid::new_v4().to_string();

    // 1. Ayarlarda təmizlik gününü 30 gün olaraq qeyd edirik
    sqlx::query("INSERT INTO settings (key, value) VALUES ('bg_autoclean_enabled', '1')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('bg_autoclean_days', '30')")
        .execute(&pool)
        .await
        .unwrap();

    // 2. İki növ deployment əlavə edirik: biri 45 gün əvvəlki (köhnə), biri 5 gün əvvəlki (təzə)
    let old_dep_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO deployments (id, application_id, status, logs, created_at) \
         VALUES (?, ?, 'success', 'old logs', datetime('now', '-45 days'))"
    )
    .bind(&old_dep_id)
    .bind(&app_id)
    .execute(&pool)
    .await
    .unwrap();

    let new_dep_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO deployments (id, application_id, status, logs, created_at) \
         VALUES (?, ?, 'success', 'recent logs', datetime('now', '-5 days'))"
    )
    .bind(&new_dep_id)
    .bind(&app_id)
    .execute(&pool)
    .await
    .unwrap();

    // 3. git_watcher-dəki təmizləmə sorğusunu simulyasiya edirik
    let autoclean_days: i32 = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 'bg_autoclean_days'")
        .fetch_one(&pool)
        .await
        .unwrap()
        .parse()
        .unwrap();

    let clean_query = format!("DELETE FROM deployments WHERE created_at < datetime('now', '-{} days')", autoclean_days);
    sqlx::query(&clean_query).execute(&pool).await.unwrap();

    // 4. Nəticələri yoxlayırıq: Köhnə silinməli, yeni qalmalıdır
    let old_exists: Option<String> = sqlx::query_scalar("SELECT id FROM deployments WHERE id = ?")
        .bind(&old_dep_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(old_exists.is_none(), "45 gün əvvəlki köhnə deployment silinməlidir");

    let new_exists: Option<String> = sqlx::query_scalar("SELECT id FROM deployments WHERE id = ?")
        .bind(&new_dep_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(new_exists.is_some(), "5 gün əvvəlki yeni deployment bazada saxlanmalıdır");
}

#[tokio::test]
async fn test_auto_deploy_interval_eligibility_logic() {
    let pool = setup_watcher_test_db().await;

    let app1_id = Uuid::new_v4().to_string();
    let app2_id = Uuid::new_v4().to_string();

    // App 1: 20 dəqiqə əvvəl yoxlanıb, interval 15 dəqiqədir -> İNDİ YOXLAMAĞA UYĞUNDUR
    sqlx::query(
        "INSERT INTO applications (id, name, auto_deploy_enabled, auto_deploy_interval, last_auto_deploy_check) \
         VALUES (?, 'ready-app', 1, 15, datetime('now', '-20 minutes'))"
    )
    .bind(&app1_id)
    .execute(&pool)
    .await
    .unwrap();

    // App 2: 3 dəqiqə əvvəl yoxlanıb, interval 15 dəqiqədir -> HƏLƏ VAXTI ÇATMAMIŞDIR
    sqlx::query(
        "INSERT INTO applications (id, name, auto_deploy_enabled, auto_deploy_interval, last_auto_deploy_check) \
         VALUES (?, 'too-early-app', 1, 15, datetime('now', '-3 minutes'))"
    )
    .bind(&app2_id)
    .execute(&pool)
    .await
    .unwrap();

    // İntervalı keçmiş tətbiqləri seçən sorğu:
    let eligible_apps: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM applications \
         WHERE auto_deploy_enabled = 1 \
         AND (last_auto_deploy_check IS NULL OR datetime(last_auto_deploy_check, '+' || auto_deploy_interval || ' minutes') <= datetime('now'))"
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(eligible_apps.len(), 1, "Yalnız vaxtı çatmış tətbiq seçilməlidir");
    assert_eq!(eligible_apps[0], app1_id, "Seçilən tətbiq ready-app olmalıdır");
}

#[tokio::test]
async fn test_tunnel_watchdog_per_app_exclusion_flag() {
    let pool = setup_watcher_test_db().await;

    let app_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO applications (id, name, cloudflare_url) \
         VALUES (?, 'production-app', 'https://prod.trycloudflare.com')"
    )
    .bind(&app_id)
    .execute(&pool)
    .await
    .unwrap();

    // Ayarlarda bu xüsusi app üçün watchdog-u söndürürük
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, '1')")
        .bind(format!("tunnel_watchdog_off_{}", app_id))
        .execute(&pool)
        .await
        .unwrap();

    let is_disabled: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(format!("tunnel_watchdog_off_{}", app_id))
        .fetch_optional(&pool)
        .await
        .unwrap();

    assert_eq!(is_disabled.as_deref(), Some("1"), "Tətbiq üçün watchdog söndürülmə bayrağı düzgün oxunmalıdır");
}
