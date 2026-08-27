use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
async fn test_process_timeout_and_kill() {
    let cmd_name = if cfg!(target_os = "windows") { "ping" } else { "sleep" };
    let cmd_args = if cfg!(target_os = "windows") { vec!["-t", "127.0.0.1"] } else { vec!["30"] };

    let mut cmd = tokio::process::Command::new(cmd_name);
    cmd.args(&cmd_args)
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().expect("Failed to spawn blocking command");

    let timeout_res = timeout(
        Duration::from_secs(2),
        child.wait()
    ).await;

    assert!(timeout_res.is_err(), "Command should have timed out");

    let kill_res = child.kill().await;
    assert!(kill_res.is_ok(), "Failed to kill the timed out child process");
}
