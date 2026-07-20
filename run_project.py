import os
import subprocess
import sys
import time

try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

CONTAINER_NAME = "masterdeploy-local-dev"
PORT = "3000"

def kill_previous_instances():
    print("[INFO] Evvelki server prosesleri yoxlanilir ve dayandirilir...")
    subprocess.run(["docker", "stop", CONTAINER_NAME], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["docker", "rm", CONTAINER_NAME], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def get_backend_mtime(src_dir):
    mtimes = []
    for root, _, files in os.walk(src_dir):
        for f in files:
            if f.endswith('.rs') or f.endswith('.toml'):
                try:
                    mtimes.append(os.path.getmtime(os.path.join(root, f)))
                except:
                    pass
    return max(mtimes) if mtimes else 0

def start_container(project_dir):
    print("[RUN] Rust Docker konteyneri hazirlanir...")
    
    local_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local_data")
    os.makedirs(local_data_dir, exist_ok=True)

    docker_socket = "/var/run/docker.sock:/var/run/docker.sock"
    user_home = os.path.expanduser("~")
    ssh_dir_volume = f"{user_home}/.ssh:/root/.ssh"

    # Named volumes istifade edirik ki, Windows-Linux kecidi zamani fayl icazeleri korlanmasin ve suretli olsun
    cmd = [
        "docker", "run", "-d", "--name", CONTAINER_NAME,
        "-p", f"{PORT}:3000",
        "-v", f"{project_dir}:/app",
        "-v", f"{local_data_dir}:/app/data",
        "-v", "masterdeploy-cargo-registry:/usr/local/cargo/registry",
        "-v", "masterdeploy-cargo-git:/usr/local/cargo/git",
        "-v", "masterdeploy-cargo-target:/app/target",
        "-v", docker_socket,
        "-v", ssh_dir_volume,
        "-w", "/app",
        "rust:1-slim-bookworm",
        "sh", "-c", "apt-get update && apt-get install -y pkg-config libssl-dev gcc libc6-dev sqlite3 openssh-client git curl && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-24.0.7.tgz | tar -xz -C /usr/local/bin --strip-components=1 docker/docker && cargo run --bin masterdeploy-rust"
    ]
    
    subprocess.run(cmd, stdout=subprocess.DEVNULL)
    print("\n🛸 MasterDeploy indi Rust Docker Konteynerinde canli (cargo run) baslayir!")
    print(f"🔗 URL: http://localhost:{PORT}")
    print("[INFO] Kodu deyisdikde daxilde avtomatik yenilenme bash verecek.")
    print("-" * 60)

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.join(base_dir, 'MasterDeploy-rust')
    if not os.path.exists(project_dir):
        project_dir = os.path.join(base_dir, 'masterdeploy-rust')
        if not os.path.exists(project_dir):
            print(f"[X] Xeta: 'MasterDeploy-rust' qovlugu tapilmadi.")
            sys.exit(1)

    kill_previous_instances()
    start_container(project_dir)

    # Loglari tail edirik
    log_proc = subprocess.Popen(["docker", "logs", "-f", CONTAINER_NAME])

    src_dir = os.path.join(project_dir, "src")
    last_mtime = get_backend_mtime(src_dir)

    try:
        while True:
            time.sleep(1)
            # Kodda deyisiklik olub-olmadigini yoxlayiriq
            current_mtime = get_backend_mtime(src_dir)
            if current_mtime > last_mtime:
                print("\n[WATCH] Kodda deyisiklik askar olundu! Konteyner yeniden basladilir...")
                
                # Kohne log izleyicisini baglayiriq
                log_proc.terminate()
                log_proc.wait()
                
                # Konteyneri restart edirik (bu zaman daxildeki cargo run yeniden tetbiq olunur)
                subprocess.run(["docker", "restart", CONTAINER_NAME], stdout=subprocess.DEVNULL)
                
                # Yeni log izleyicisini aciriq
                log_proc = subprocess.Popen(["docker", "logs", "-f", CONTAINER_NAME])
                last_mtime = current_mtime
                print("[WATCH] Konteyner yeni kodla yeniden basladildi.\n")
                
    except KeyboardInterrupt:
        print("\n[STOP] Konteyner dayandirilir...")
        log_proc.terminate()
        kill_previous_instances()

if __name__ == "__main__":
    main()
