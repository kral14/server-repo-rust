-- Baseline database structure
CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    ssh_user TEXT NOT NULL,
    ssh_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    branch TEXT NOT NULL,
    port INTEGER NOT NULL,
    server_id TEXT NOT NULL,
    status TEXT NOT NULL,
    env_vars TEXT,
    build_pack_type TEXT DEFAULT 'dockerfile',
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
    cloudflare_url TEXT,
    cf_worker_url TEXT,
    deploy_type TEXT DEFAULT 'git',
    registry_image TEXT,
    last_commit_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(server_id) REFERENCES servers(id)
);

CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    status TEXT NOT NULL,
    logs TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    log_type TEXT NOT NULL,
    module TEXT,
    operator_name TEXT,
    target_id TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
