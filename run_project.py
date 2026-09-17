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
        "sh", "-c", "apt-get update && apt-get install -y pkg-config libssl-dev gcc libc6-dev sqlite3 openssh-client git curl procps && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-24.0.7.tgz | tar -xz -C /usr/local/bin --strip-components=1 docker/docker && cargo run --bin masterdeploy-rust"
    ]
    
    subprocess.run(cmd, stdout=subprocess.DEVNULL)
    print("\n🛸 MasterDeploy indi Rust Docker Konteynerinde canli (cargo run) baslayir!")
    print(f"🔗 URL: http://localhost:{PORT}")
    print("[INFO] Kodu deyisdikde daxilde avtomatik yenilenme bash verecek.")
    print("-" * 60)

def sync_remote_database(local_data_dir):
    key_path = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ssh-key-MasterDeploy.key"))
    host = "ubuntu@84.8.148.216"
    local_db = os.path.normpath(os.path.join(local_data_dir, "masterdeploy.db"))
    
    if not os.path.exists(key_path):
        print(f"[XƏTA] SSH açarı tapılmadı: {key_path}")
        return
        
    print("\n[SYNC 1/2] Uzaq VM-də bazanın nüsxəsi hazırlanır...")
    prepare_cmd = (
        "sudo docker exec masterdeploy sqlite3 /app/data/masterdeploy.db 'VACUUM;' 2>/dev/null; "
        "sudo docker cp masterdeploy:/app/data/masterdeploy.db /tmp/md_sync.db && "
        "sudo chmod 666 /tmp/md_sync.db"
    )
    res = subprocess.run(
        ["ssh", "-i", key_path, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=6", host, prepare_cmd],
        capture_output=True, text=True
    )
    if res.returncode != 0:
        print(f"[XƏTA] Uzaq serverdə nüsxə hazırlana bilmədi: {res.stderr.strip()}")
        return

    print("[SYNC 2/2] masterdeploy.db lokal qovluğa endirilir...")
    tmp_local_db = os.path.normpath(os.path.join(local_data_dir, "masterdeploy_temp.db"))
    if os.path.exists(tmp_local_db):
        try: os.remove(tmp_local_db)
        except: pass

    scp_res = subprocess.run(
        ["scp", "-i", key_path, "-o", "StrictHostKeyChecking=no", f"{host}:/tmp/md_sync.db", tmp_local_db],
        capture_output=True, text=True
    )
    if scp_res.returncode == 0 and os.path.exists(tmp_local_db):
        try:
            if os.path.exists(local_db):
                os.remove(local_db)
            os.replace(tmp_local_db, local_db)
            size_kb = os.path.getsize(local_db) / 1024
            print(f"✅ [UĞURLU] Uzaq baza tam sinxronlaşdırıldı! Həcm: {size_kb:.1f} KB\n")
        except Exception as rename_err:
            print(f"[XƏTA] Baza faylı əvəzlənə bilmədi: {rename_err}")
    else:
        print(f"[XƏTA] Baza faylı scp ilə endirilə bilmədi: {scp_res.stderr.strip()}\n")

def ask_sync_remote_db(local_data_dir):
    print("\n" + "=" * 60)
    print(" 🔄 MASTERDEPLOY VERİLƏNLƏR BAZASI SİNXRONİZASİYASI")
    print("=" * 60)
    print(" Uzaq VM-dən (84.8.148.216) ən son bazanı (masterdeploy.db)")
    print(" çəkib lokal mühitlə sinxronlaşdırmaq istəyirsiniz?")
    print("   [1 / y / hə]  -> Bəli, uzaq bazanı çək və sinxron başlat")
    print("   [2 / n / yox] -> Xeyr, mövcud lokal baza ilə davam et")
    print("=" * 60)
    
    try:
        choice = input(" Seçiminiz (Enter = Xeyr): ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        choice = ""
        
    if choice in ['1', 'y', 'yes', 'he', 'hə', 'bəli', 'beli', 's']:
        sync_remote_database(local_data_dir)
    else:
        print("[INFO] Sinxronizasiya edilmədi. Mövcud lokal baza istifadə olunur.\n")

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.join(base_dir, 'MasterDeploy-rust')
    if not os.path.exists(project_dir):
        project_dir = os.path.join(base_dir, 'masterdeploy-rust')
        if not os.path.exists(project_dir):
            print(f"[X] Xeta: 'MasterDeploy-rust' qovlugu tapilmadi.")
            sys.exit(1)

    # 1. İlk öncə əvvəlki işlək konteyneri dayandırırıq ki, SQLite faylı kilidli (lock) qalmasın!
    kill_previous_instances()

    # 2. Lazım olarsa bazanı sinxronlaşdırırıq
    local_data_dir = os.path.join(base_dir, "local_data")
    os.makedirs(local_data_dir, exist_ok=True)
    ask_sync_remote_db(local_data_dir)

    # 3. Konteyneri təzə/təmiz baza ilə başladırıq
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
