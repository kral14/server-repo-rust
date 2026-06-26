use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub ssh_user: String,
    pub ssh_key: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerInput {
    pub name: String,
    pub ip: String,
    pub ssh_user: String,
    pub ssh_key: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerInput {
    pub name: String,
    pub ip: String,
    pub ssh_user: String,
    pub ssh_key: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Application {
    pub id: String,
    pub name: String,
    pub repo_url: String,
    pub branch: String,
    pub server_id: String,
    pub status: String,
    pub port: i64,
    pub env_vars: Option<String>,
    pub build_pack_type: Option<String>,
    pub build_command: Option<String>,
    pub run_command: Option<String>,
    pub dockerfile_path: Option<String>,
    pub entrypoint: Option<String>,
    pub command: Option<String>,
    pub target: Option<String>,
    pub work_dir: Option<String>,
    pub privileged: Option<i64>,
    pub memory_limit: Option<String>,
    pub cpu_limit: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateApplicationInput {
    pub name: String,
    pub server_id: String,
    pub repo_url: String,
    pub branch: String,
    pub port: i64,
    pub env_vars: Option<String>,
    pub build_pack_type: Option<String>,
    pub build_command: Option<String>,
    pub run_command: Option<String>,
    pub dockerfile_path: Option<String>,
    pub entrypoint: Option<String>,
    pub command: Option<String>,
    pub target: Option<String>,
    pub work_dir: Option<String>,
    pub privileged: Option<i64>,
    pub memory_limit: Option<String>,
    pub cpu_limit: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateApplicationInput {
    pub repo_url: Option<String>,
    pub branch: Option<String>,
    pub port: Option<i64>,
    pub env_vars: Option<String>,
    pub build_pack_type: Option<String>,
    pub build_command: Option<String>,
    pub run_command: Option<String>,
    pub dockerfile_path: Option<String>,
    pub entrypoint: Option<String>,
    pub command: Option<String>,
    pub target: Option<String>,
    pub work_dir: Option<String>,
    pub privileged: Option<i64>,
    pub memory_limit: Option<String>,
    pub cpu_limit: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Deployment {
    pub id: String,
    pub application_id: String,
    pub status: String,
    pub logs: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct ActivityLog {
    pub id: String,
    pub message: String,
    pub log_type: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateActivityLogInput {
    pub message: String,
    pub log_type: String,
}