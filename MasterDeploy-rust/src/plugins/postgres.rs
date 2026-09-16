use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    routing::{get, post, delete},
    Json, Router,
};
use uuid::Uuid;
use sqlx::SqlitePool;
use crate::models::{
    Server, PostgresInstanceStatus, InstallPostgresInput, CreatePostgresDbInput,
    PostgresDbRecord, AddWhitelistIpInput, TogglePortInput,
};
use crate::utils::add_activity_log_pro;
use crate::AppState;

pub fn postgres_router() -> Router<AppState> {
    Router::new()
        .route("/status/:server_id", get(get_status))
        .route("/install/:server_id", post(install_postgres))
        .route("/create-db/:server_id", post(create_database))
        .route("/list-dbs/:server_id", get(list_databases))
        .route("/delete-db/:server_id/:db_name", delete(delete_database))
        .route("/whitelist-ip/:server_id", post(whitelist_ip))
        .route("/port-status/:server_id", get(get_port_status))
        .route("/toggle-port/:server_id", post(toggle_port_exposure))
}

fn generate_random_password(len: usize) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    
    let mut rng_seed = nanos;
    let mut pass = String::with_capacity(len);
    for _ in 0..len {
        rng_seed = rng_seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let idx = (rng_seed >> 32) as usize % chars.len();
        pass.push(chars.chars().nth(idx).unwrap_or('x'));
    }
    pass
}

async fn get_server_by_id(db: &SqlitePool, server_id: &str) -> Result<Server, (StatusCode, String)> {
    sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(server_id)
        .fetch_optional(db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Server tapılmadı".to_string()))
}

async fn run_ssh_quick(server: &Server, db: &SqlitePool, cmd: &str) -> Result<String, String> {
    if server.ip == "local" || server.ip == "127.0.0.1" {
        let output = if cfg!(target_os = "windows") {
            tokio::process::Command::new("cmd")
                .args(["/C", cmd])
                .output()
                .await
        } else {
            tokio::process::Command::new("sh")
                .args(["-c", cmd])
                .output()
                .await
        };

        return match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                if out.status.success() {
                    Ok(stdout)
                } else {
                    Err(format!("Lokal əmr xətası: {}\n{}", stdout, stderr))
                }
            }
            Err(e) => Err(format!("Lokal icra xətası: {}", e)),
        };
    }

    let key_content = if let Some(ref kid) = server.ssh_key_id {
        let db_key: Option<(String,)> = sqlx::query_as("SELECT private_key FROM ssh_keys WHERE id = ?")
            .bind(kid)
            .fetch_optional(db)
            .await
            .unwrap_or_default();
        db_key.map(|r| r.0).unwrap_or_else(|| server.ssh_key.clone())
    } else {
        server.ssh_key.clone()
    };

    let temp_key_path = match crate::ssh::write_temp_ssh_key("temp_pg_key", &key_content) {
        Ok(p) => p,
        Err(e) => return Err(format!("SSH açar faylı hazırlana bilmədi: {}", e)),
    };

    let output = tokio::process::Command::new("ssh")
        .args([
            "-i", &temp_key_path,
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ConnectTimeout=10",
            &format!("{}@{}", server.ssh_user, server.ip),
            cmd,
        ])
        .output()
        .await;

    let _ = std::fs::remove_file(&temp_key_path);

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if out.status.success() {
                Ok(stdout)
            } else {
                Err(format!("Əmr xətası (status {}): {}\n{}", out.status, stdout, stderr))
            }
        }
        Err(e) => Err(format!("SSH bağlantı xətası: {}", e)),
    }
}

pub async fn get_status(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<PostgresInstanceStatus>, (StatusCode, String)> {
    let server = get_server_by_id(&state.db, &server_id).await?;

    let check_cmd = "if sudo docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^masterdeploy-postgres$'; then echo 'running'; elif sudo docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q '^masterdeploy-postgres$'; then echo 'stopped'; else echo 'not_found'; fi";
    let res = run_ssh_quick(&server, &state.db, check_cmd).await;

    let (installed, running) = match res {
        Ok(output) => {
            let trimmed = output.trim();
            if trimmed.contains("running") {
                (true, true)
            } else if trimmed.contains("stopped") {
                (true, false)
            } else {
                (false, false)
            }
        }
        Err(err) => {
            eprintln!("[POSTGRES-STATUS-ERR] Server: {}, Error: {}", server.ip, err);
            (false, false)
        }
    };

    Ok(Json(PostgresInstanceStatus {
        installed,
        running,
        container_name: "masterdeploy-postgres".to_string(),
        port: 5432,
        server_ip: server.ip,
        data_dir: "/data/postgres-data".to_string(),
    }))
}

pub async fn install_postgres(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
    payload: Option<Json<InstallPostgresInput>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = get_server_by_id(&state.db, &server_id).await?;
    let input = payload.map(|p| p.0).unwrap_or(InstallPostgresInput { port: None, root_password: None });

    let port = input.port.unwrap_or(5432);
    let root_pass = input.root_password.unwrap_or_else(|| generate_random_password(32));

    let install_cmd = format!(
        "sudo mkdir -p /data/postgres-data && \
         sudo chmod 700 /data/postgres-data && \
         sudo docker rm -f masterdeploy-postgres 2>/dev/null || true && \
         sudo docker run -d \
           --name masterdeploy-postgres \
           --restart always \
           -p {port}:5432 \
           -v /data/postgres-data:/var/lib/postgresql/data \
           -e POSTGRES_PASSWORD='{root_pass}' \
           postgres:16-alpine && \
         while sudo iptables -D DOCKER-USER -p tcp --dport {port} -j DROP 2>/dev/null; do :; done; \
         sudo iptables -I DOCKER-USER 1 -p tcp --dport {port} -j ACCEPT 2>/dev/null || true && \
         sudo ufw allow {port}/tcp 2>/dev/null || true && \
         sudo ufw reload 2>/dev/null || true",
        port = port,
        root_pass = root_pass
    );

    match run_ssh_quick(&server, &state.db, &install_cmd).await {
        Ok(_) => {
            // server_plugins cədvəlində qeydiyyat aparırıq
            let rec_id = Uuid::new_v4().to_string();
            let now_str = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                .to_string();

            let cfg = serde_json::json!({
                "port": port,
                "data_dir": "/data/postgres-data",
                "installed_at": now_str,
            }).to_string();

            let _ = sqlx::query(
                "INSERT INTO server_plugins (id, server_id, plugin_name, status, config_json) \
                 VALUES (?, ?, 'postgres', 'installed', ?) \
                 ON CONFLICT(server_id, plugin_name) DO UPDATE SET status = 'installed', config_json = ?, updated_at = CURRENT_TIMESTAMP"
            )
            .bind(&rec_id)
            .bind(&server.id)
            .bind(&cfg)
            .bind(&cfg)
            .execute(&state.db)
            .await;

            add_activity_log_pro(
                &state.db,
                &format!("PostgreSQL mühərriki '{}' serverində quraşdırıldı (Port: {})", server.name, port),
                "success",
                Some("PostgresPlugin"),
                Some("admin"),
                Some(&server.id),
                None,
            ).await;

            Ok(Json(serde_json::json!({
                "success": true,
                "message": format!("PostgreSQL uğurla quraşdırıldı (Port: {})", port),
                "port": port
            })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Postgres quraşdırma xətası: {}", e))),
    }
}

pub async fn create_database(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
    Json(input): Json<CreatePostgresDbInput>,
) -> Result<Json<PostgresDbRecord>, (StatusCode, String)> {
    let server = get_server_by_id(&state.db, &server_id).await?;

    let raw_name = input.app_name.trim().to_lowercase();
    let clean_app_name: String = raw_name.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();

    if clean_app_name.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Layihə adı boş ola bilməz".to_string()));
    }

    let db_name = format!("db_{}", clean_app_name);
    let db_user = format!("user_{}", clean_app_name);
    let db_password = generate_random_password(24);
    let port: i64 = 5432;

    // PostgreSQL daxilində user və database yaradılması üçün SQL
    let create_sql = format!(
        "sudo docker exec -i masterdeploy-postgres psql -U postgres << 'EOF'\n\
         DO $$\n\
         BEGIN\n\
           IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '{user}') THEN\n\
             CREATE USER \"{user}\" WITH ENCRYPTED PASSWORD '{pass}';\n\
           ELSE\n\
             ALTER USER \"{user}\" WITH ENCRYPTED PASSWORD '{pass}';\n\
           END IF;\n\
         END\n\
         $$;\n\
         SELECT 'CREATE DATABASE \"{db}\" OWNER \"{user}\"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '{db}')\\gexec\n\
         GRANT ALL PRIVILEGES ON DATABASE \"{db}\" TO \"{user}\";\n\
         ALTER DATABASE \"{db}\" OWNER TO \"{user}\";\n\
         EOF",
        user = db_user,
        pass = db_password,
        db = db_name
    );

    if let Err(e) = run_ssh_quick(&server, &state.db, &create_sql).await {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Baza yaradılarkən xəta: {}", e)));
    }

    // PostgreSQL 15/16 üçün public schema icazələrinin verilməsi (Cədvəl yaratma xətasının qarşısını alır)
    let schema_perm_sql = format!(
        "sudo docker exec -i masterdeploy-postgres psql -U postgres -d {db} << 'EOF'\n\
         GRANT ALL ON SCHEMA public TO \"{user}\";\n\
         GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"{user}\";\n\
         GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO \"{user}\";\n\
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO \"{user}\";\n\
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO \"{user}\";\n\
         EOF",
        user = db_user,
        db = db_name
    );
    let _ = run_ssh_quick(&server, &state.db, &schema_perm_sql).await;

    // Serverdə port 5432-ni həm DOCKER-USER iptables, həm də UFW-də xaricə tam açırıq
    let firewall_cmd = format!(
        "while sudo iptables -D DOCKER-USER -p tcp --dport {port} -j DROP 2>/dev/null; do :; done; \
         while sudo iptables -D DOCKER-USER -p tcp --dport {port} -j ACCEPT 2>/dev/null; do :; done; \
         sudo iptables -I DOCKER-USER 1 -p tcp --dport {port} -j ACCEPT 2>/dev/null || true; \
         sudo ufw allow {port}/tcp 2>/dev/null || true; \
         sudo ufw reload 2>/dev/null || true",
        port = port
    );
    let _ = run_ssh_quick(&server, &state.db, &firewall_cmd).await;

    let connection_string = format!(
        "postgresql://{user}:{pass}@{host}:{port}/{db}",
        user = db_user,
        pass = db_password,
        host = server.ip,
        port = port,
        db = db_name
    );

    let id = Uuid::new_v4().to_string();

    let _ = sqlx::query(
        "INSERT INTO postgres_databases (id, server_id, app_name, db_name, db_user, db_password, port, connection_string, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) \
         ON CONFLICT(server_id, db_name) DO UPDATE SET \
           db_user = excluded.db_user, \
           db_password = excluded.db_password, \
           connection_string = excluded.connection_string, \
           created_at = CURRENT_TIMESTAMP"
    )
    .bind(&id)
    .bind(&server.id)
    .bind(&clean_app_name)
    .bind(&db_name)
    .bind(&db_user)
    .bind(&db_password)
    .bind(port)
    .bind(&connection_string)
    .execute(&state.db)
    .await;

    add_activity_log_pro(
        &state.db,
        &format!("Yeni layihə bazası yaradıldı: '{}' (User: {})", db_name, db_user),
        "success",
        Some("PostgresPlugin"),
        Some("admin"),
        Some(&server.id),
        None,
    ).await;

    let record = PostgresDbRecord {
        id,
        server_id: server.id,
        app_name: clean_app_name,
        db_name,
        db_user,
        db_password,
        port,
        connection_string,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string(),
    };

    Ok(Json(record))
}

pub async fn list_databases(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<Vec<PostgresDbRecord>>, (StatusCode, String)> {
    let records = sqlx::query_as::<_, PostgresDbRecord>(
        "SELECT id, server_id, app_name, db_name, db_user, db_password, port, connection_string, created_at \
         FROM postgres_databases WHERE server_id = ? ORDER BY created_at DESC"
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(records))
}

pub async fn delete_database(
    State(state): State<AppState>,
    AxumPath((server_id, db_name)): AxumPath<(String, String)>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let server = get_server_by_id(&state.db, &server_id).await?;

    let drop_sql = format!(
        "sudo docker exec -i masterdeploy-postgres psql -U postgres << 'EOF'\n\
         SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{db}';\n\
         DROP DATABASE IF EXISTS {db};\n\
         EOF",
        db = db_name
    );

    let _ = run_ssh_quick(&server, &state.db, &drop_sql).await;

    let _ = sqlx::query("DELETE FROM postgres_databases WHERE server_id = ? AND db_name = ?")
        .bind(&server_id)
        .bind(&db_name)
        .execute(&state.db)
        .await;

    add_activity_log_pro(
        &state.db,
        &format!("PostgreSQL bazası silindi: '{}'", db_name),
        "warning",
        Some("PostgresPlugin"),
        Some("admin"),
        Some(&server_id),
        None,
    ).await;

    Ok(Json(true))
}

pub async fn whitelist_ip(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
    Json(input): Json<AddWhitelistIpInput>,
) -> Result<Json<bool>, (StatusCode, String)> {
    let server = get_server_by_id(&state.db, &server_id).await?;
    let port = input.port.unwrap_or(5432);
    let ip = input.client_ip.trim();

    if ip.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "IP ünvanı boş ola bilməz".to_string()));
    }

    let ufw_cmd = format!(
        "sudo ufw allow from {ip} to any port {port} proto tcp 2>/dev/null || true && sudo ufw reload 2>/dev/null || true",
        ip = ip,
        port = port
    );

    match run_ssh_quick(&server, &state.db, &ufw_cmd).await {
        Ok(_) => {
            add_activity_log_pro(
                &state.db,
                &format!("IP '{}' PostgreSQL (Port: {}) üçün Firewall-da ağ siyahıya əlavə edildi", ip, port),
                "info",
                Some("PostgresPlugin"),
                Some("admin"),
                Some(&server_id),
                None,
            ).await;
            Ok(Json(true))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Firewall yenilənmə xətası: {}", e))),
    }
}

pub async fn get_port_status(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = get_server_by_id(&state.db, &server_id).await?;
    let port: u16 = 5432;

    // UFW və ya DOCKER-USER qaydalarını yoxlayırıq
    let check_cmd = format!(
        "sudo iptables -S DOCKER-USER 2>/dev/null | grep -E -- '-p tcp.*--dport {port} -j DROP' || sudo ufw status 2>/dev/null | grep -E '{port}/tcp.*DENY'",
        port = port
    );

    let is_blocked = match run_ssh_quick(&server, &state.db, &check_cmd).await {
        Ok(out) => !out.trim().is_empty(),
        Err(_) => false,
    };

    Ok(Json(serde_json::json!({
        "port": port,
        "is_open": !is_blocked
    })))
}

pub async fn toggle_port_exposure(
    State(state): State<AppState>,
    AxumPath(server_id): AxumPath<String>,
    Json(input): Json<TogglePortInput>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let server = get_server_by_id(&state.db, &server_id).await?;
    let port = input.port.unwrap_or(5432);

    let cmd = if input.open {
        // Portu xaricə AÇIRIQ:
        format!(
            "while sudo iptables -D DOCKER-USER -p tcp --dport {port} -j DROP 2>/dev/null; do :; done; \
             while sudo iptables -D DOCKER-USER -p tcp --dport {port} -j ACCEPT 2>/dev/null; do :; done; \
             sudo iptables -I DOCKER-USER 1 -p tcp --dport {port} -j ACCEPT 2>/dev/null || true && \
             sudo ufw delete deny {port}/tcp 2>/dev/null || true && \
             sudo ufw allow {port}/tcp 2>/dev/null || true && \
             sudo ufw reload 2>/dev/null || true",
            port = port
        )
    } else {
        // Portu xaricə BAĞLAYIRIQ (yalnız daxili Docker və localhost icazəli qalır):
        format!(
            "while sudo iptables -D DOCKER-USER -p tcp --dport {port} -j DROP 2>/dev/null; do :; done; \
             while sudo iptables -D DOCKER-USER -p tcp --dport {port} -j ACCEPT 2>/dev/null; do :; done; \
             sudo iptables -I DOCKER-USER 1 -s 127.0.0.1 -p tcp --dport {port} -j ACCEPT 2>/dev/null || true && \
             sudo iptables -I DOCKER-USER 2 -s 172.16.0.0/12 -p tcp --dport {port} -j ACCEPT 2>/dev/null || true && \
             sudo iptables -I DOCKER-USER 3 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true && \
             sudo iptables -A DOCKER-USER -p tcp --dport {port} -j DROP 2>/dev/null || true && \
             sudo ufw delete allow {port}/tcp 2>/dev/null || true && \
             sudo ufw deny {port}/tcp 2>/dev/null || true && \
             sudo ufw reload 2>/dev/null || true",
            port = port
        )
    };

    match run_ssh_quick(&server, &state.db, &cmd).await {
        Ok(_) => {
            let msg = if input.open {
                format!("PostgreSQL portu ({}) xaricə açıldı (istənilən IP qoşula bilər)", port)
            } else {
                format!("PostgreSQL portu ({}) xaricə bağlandı (təhlükəsiz rejim aktivdir)", port)
            };

            add_activity_log_pro(
                &state.db,
                &format!("'{}' serverində {}", server.name, msg),
                if input.open { "warning" } else { "success" },
                Some("PostgresPlugin"),
                Some("admin"),
                Some(&server_id),
                None,
            ).await;

            Ok(Json(serde_json::json!({
                "success": true,
                "is_open": input.open,
                "message": msg
            })))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, format!("Firewall əmri icra edilərkən xəta: {}", e))),
    }
}
