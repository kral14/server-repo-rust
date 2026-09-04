use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn write_temp_ssh_key(prefix: &str, key_content: &str) -> Result<String, String> {
    let temp_key_path = std::env::temp_dir()
        .join(format!("{}_{}.key", prefix, uuid::Uuid::new_v4()))
        .to_string_lossy()
        .into_owned();

    let key_data = if key_content.contains("BEGIN ") {
        key_content.to_string()
    } else {
        std::fs::read_to_string(key_content.trim()).unwrap_or_else(|_| key_content.to_string())
    };

    let normalized_key = key_data.replace("\r\n", "\n").replace('\r', "\n").trim().to_string() + "\n";
    if let Err(e) = std::fs::write(&temp_key_path, &normalized_key) {
        return Err(format!("Açar yazıla bilmədi: {}", e));
    }

    #[cfg(target_os = "windows")]
    {
        let identity = std::env::var("USERNAME").unwrap_or_else(|_| "Administrator".to_string());
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/inheritance:r"]).output();
        let _ = std::process::Command::new("icacls").args(&[&temp_key_path, "/grant:r", &format!("{}:F", identity)]).output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("chmod").args(&["600", &temp_key_path]).output();
    }

    Ok(temp_key_path)
}

pub fn get_local_ssh_key_content() -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    
    let ssh_dir = Path::new(&home).join(".ssh");
    let key_path = ssh_dir.join("id_rsa");
    let pub_path = ssh_dir.join("id_rsa.pub");

    if !key_path.exists() {
        let _ = std::fs::create_dir_all(&ssh_dir);
        let output = if cfg!(target_os = "windows") {
            std::process::Command::new("ssh-keygen")
                .args(&["-t", "rsa", "-b", "3072", "-f", key_path.to_str().unwrap(), "-N", ""])
                .output()
        } else {
            std::process::Command::new("ssh-keygen")
                .args(&["-t", "rsa", "-b", "3072", "-f", key_path.to_str().unwrap(), "-N", "", "-q"])
                .output()
        };
        if let Err(e) = output {
            return Err(format!("Açar yaradıla bilmədi: {}", e));
        }
    }

    std::fs::read_to_string(pub_path)
        .map(|k| k.trim().to_string())
        .map_err(|e| format!("Public key oxuna bilmədi: {}", e))
}

pub fn generate_rsa_keypair_content() -> Result<(String, String), String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let tmp_dir = std::env::temp_dir();
    let key_name = format!("masterdeploy_rsa_{}", ts);
    let key_path = tmp_dir.join(&key_name);
    let pub_path = tmp_dir.join(format!("{}.pub", &key_name));

    let output = if cfg!(target_os = "windows") {
        std::process::Command::new("ssh-keygen")
            .args(&["-t", "rsa", "-b", "4096", "-f", key_path.to_str().unwrap(), "-N", ""])
            .output()
    } else {
        std::process::Command::new("ssh-keygen")
            .args(&["-t", "rsa", "-b", "4096", "-f", key_path.to_str().unwrap(), "-N", "", "-q"])
            .output()
    };

    match output {
        Err(e) => return Err(format!("ssh-keygen çalıştırıla bilmədi: {}", e)),
        Ok(out) if !out.status.success() => {
            let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
            let _ = std::fs::remove_file(&key_path);
            let _ = std::fs::remove_file(&pub_path);
            return Err(format!("ssh-keygen xətası: {}", err_msg));
        }
        _ => {}
    }

    let private_key = std::fs::read_to_string(&key_path)
        .map_err(|e| format!("Private key oxuna bilmədi: {}", e))?;
    let public_key = std::fs::read_to_string(&pub_path)
        .map_err(|e| format!("Public key oxuna bilmədi: {}", e))?;

    let _ = std::fs::remove_file(&key_path);
    let _ = std::fs::remove_file(&pub_path);

    Ok((private_key.trim().to_string(), public_key.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_and_cleanup_temp_ssh_key() {
        let fake_key = "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n";
        let path_res = write_temp_ssh_key("test_key", fake_key);
        assert!(path_res.is_ok());
        let path = path_res.unwrap();
        assert!(std::path::Path::new(&path).exists());
        let _ = std::fs::remove_file(&path);
        assert!(!std::path::Path::new(&path).exists());
    }
}
