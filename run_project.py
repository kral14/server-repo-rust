import os
import subprocess
import sys
import time

def kill_previous_instances():
    print("[INFO] Evvelki server prosesleri yoxlanilir ve dayandirilir...")
    try:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/F', '/IM', 'masterdeploy-rust.exe', '/T'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['taskkill', '/F', '/IM', 'tauri.exe', '/T'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['taskkill', '/F', '/IM', 'app.exe', '/T'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            subprocess.run(['pkill', '-f', 'masterdeploy-rust'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['pkill', '-f', 'tauri'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def get_backend_mtime(src_dir):
    mtimes = []
    for root, _, files in os.walk(src_dir):
        for f in files:
            if f.endswith('.rs'):
                try:
                    mtimes.append(os.path.getmtime(os.path.join(root, f)))
                except:
                    pass
    return max(mtimes) if mtimes else 0

def sync_database_from_remote():
    import json
    base_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(base_dir, "config.json")
    
    if not os.path.exists(config_path):
        print("[SYNC ERROR] config.json tapilmadi, sinxronizasiya es gecilir.")
        return
        
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
        ip = config.get("ip", "").strip()
        user = config.get("user", "ubuntu").strip()
        key_path = config.get("key", "").strip()
        
        if not ip or not key_path:
            print("[SYNC ERROR] IP ve ya Key tapilmadi, sinxronizasiya es gecilir.")
            return

        print(f"[SYNC] Uzak merkezi serverden ({ip}) SQLite verilenler bazasi yuklenir...")
        local_db_path = os.path.join(base_dir, "MasterDeploy-rust", "masterdeploy.db")

        # Database faylını SCP ilə kopyalayırıq
        scp_cmd = [
            "scp.exe", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
            "-i", key_path,
            f"{user}@{ip}:/data/masterdeploy/masterdeploy.db",
            local_db_path
        ]
        res = subprocess.run(scp_cmd, capture_output=True, text=True)
        if res.returncode == 0:
            print("[SYNC] Baza ugurla sinxronlasdirildi! (masterdeploy.db yenilendi)")
        else:
            print("[SYNC ERROR] SCP ugursuz oldu. Kohne bazadan istifade olunacaq.")
            print(res.stderr)
    except Exception as e:
        print(f"[SYNC ERROR] Sinxronizasiya zamani gozlenilmez xeta: {e}")


def upload_database_to_remote():
    import json
    base_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(base_dir, "config.json")
    
    if not os.path.exists(config_path):
        print("[SYNC ERROR] config.json tapilmadi, sinxronizasiya es gecilir.")
        return
        
    try:
        with open(config_path, "r") as f:
            config = json.load(f)
        ip = config.get("ip", "").strip()
        user = config.get("user", "ubuntu").strip()
        key_path = config.get("key", "").strip()
        
        if not ip or not key_path:
            print("[SYNC ERROR] IP ve ya Key tapilmadi, sinxronizasiya es gecilir.")
            return

        print(f"[SYNC] Lokal SQLite verilenler bazasi uzak merkezi servere ({ip}) yuklenir...")
        local_db_path = os.path.join(base_dir, "MasterDeploy-rust", "masterdeploy.db")

        # Database-i uzaq servere geri yukleyirik
        scp_cmd = [
            "scp.exe", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
            "-i", key_path,
            local_db_path,
            f"{user}@{ip}:/data/masterdeploy/masterdeploy.db"
        ]
        res = subprocess.run(scp_cmd, capture_output=True, text=True)
        if res.returncode == 0:
            print("[SYNC] Lokal baza ugurla uzaq servere yazildi! (VM yenilendi)")
        else:
            print("[SYNC ERROR] SCP ile bazani geri yuklemek mumkun olmadi.")
            print(res.stderr)
    except Exception as e:
        print(f"[SYNC ERROR] Geri yukleme zamani gozlenilmez xeta: {e}")


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.join(base_dir, 'masterdeploy-rust')
    src_dir = os.path.join(project_dir, 'src')
    
    if not os.path.exists(project_dir):
        print(f"[X] Xeta: '{project_dir}' qovlugu tapilmadi.")
        sys.exit(1)

    kill_previous_instances()
    sync_database_from_remote()

    print(">> MasterDeploy Backend server ise salinir (cargo run)...")
    
    try:
        backend_process = subprocess.Popen(
            ["cargo", "run", "--bin", "masterdeploy-rust"],
            cwd=project_dir,
            stdout=sys.stdout,
            stderr=sys.stderr,
            text=True
        )
        
        time.sleep(3)
        
        print("\n>> Tauri dev ise salinir (npx @tauri-apps/cli dev)...")
        tauri_process = subprocess.Popen(
            ["npx", "@tauri-apps/cli", "dev"],
            cwd=project_dir,
            stdout=sys.stdout,
            stderr=sys.stderr,
            text=True,
            shell=True
        )
        
        # Backend kodlarının ilkin modifikasiya vaxtını alırıq
        last_mtime = get_backend_mtime(src_dir)
        
        # Tauri aktiv olduğu müddətdə nəzarət edirik
        while tauri_process.poll() is None:
            time.sleep(1)
            
            # Backend kodlarında dəyişiklik yoxlanılır
            current_mtime = get_backend_mtime(src_dir)
            if current_mtime > last_mtime:
                print("\n[WATCH] Backend kodunda deyisiklik askar olundu. Backend yeniden basladilir...")
                
                # Köhnə backend prosesini öldürürük
                backend_process.terminate()
                try:
                    backend_process.wait(timeout=2)
                except:
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/F', '/IM', 'masterdeploy-rust.exe', '/T'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    else:
                        subprocess.run(['pkill', '-f', 'masterdeploy-rust'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
                # Yeni backend-i başladırıq
                backend_process = subprocess.Popen(
                    ["cargo", "run", "--bin", "masterdeploy-rust"],
                    cwd=project_dir,
                    stdout=sys.stdout,
                    stderr=sys.stderr,
                    text=True
                )
                last_mtime = current_mtime
                print("[WATCH] Backend yeni kodla ugurla ise salindi.\n")
        
        # Tauri pəncərəsi bağlandıqda backend-i dayandırırıq
        backend_process.terminate()
        upload_database_to_remote()
        
    except KeyboardInterrupt:
        print("\n[STOP] Istifadeci terefinden serverler dayandirildi.")
        try:
            tauri_process.terminate()
        except:
            pass
        try:
            backend_process.terminate()
        except:
            pass
        upload_database_to_remote()
    except FileNotFoundError:
        print("[X] Xeta: 'cargo' ve ya 'tauri' emri tapilmadi. Qurasdirildiqlarindan emin olun.")
    except Exception as e:
        print(f"[X] Gozlenilmez xeta bas verdi: {e}")

if __name__ == "__main__":
    main()
