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
    print("[SYNC] Uzak merkezi serverden (84.8.148.216) SQLite verilenler bazasi yuklenir...")
    
    key_content = """-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAn6XItsoash9Cr1yD4Doxsmps9LisPUfLnyc65cceyBXMEyV2
jkPRRxDdtLBM5WA378+JjDbYLJCZwyQmOOYAbXn3SJHTbqrNxjsairI3EK+sYXbz
HmxYpS00owvjfcAYIbiOBM7L2w/+BnInkQo3EkfccE9zYW7PMHx70WYLKVGNTbod
pUvZy8SWH51zJ6jy4x+US6OkEg6TW73mrCsWEgvl7O/9gvYb0XFyChBSRe9W9mW1
I0jTPP7Vk/LP2reZ5Locz97j8nUIVp0nmuB2abQi5ucssVbAYNxRX/mb6mog4cqa
aTdT+xV7yov3EwK7sfziAM0Id8gpclReH6XPYQIDAQABAoIBABb3box9PqHpRVqc
4IvdU1DrZok+F+ko7u4SYrKzloYKPLV0aj3FG9IxZvObeTR2RxXEsXDuYuLmWnhs
NuNwkxcsuJpEADqnb7rYvdS+FpXb79yFlCwIQihg/HWIPE3W2KHhPu0KIuF8x3p9
6Zs/8PQ8SkYN5/dYTY4YGmfhWjGzQ4n79dCO+K8GG7NKUFbeDsRQJEq5Q6rEhyox
5ITK+12ndzYF1oGXdQs66PJrVx93VLSBTTqGcuS9UAV1QMJqOU78zyOGvUlY9ILp
pMG90LnebsuhzNppKhfpVDePmn58IKWTt9HdMh3l1fkf9aohf/glyMKpJPOb4jjP
HwWGOJECgYEAyxEHs5yIucANoCHYO+HSsVc6zmlFJA2i8SzlBkcqHPMTHqg3ZKbX
cz1awuHvmy5t144/wdPNWAldWvTdsQut/80Q+Yrd+h6ta1K0HOVdvDSMcXKSRE1o
SX5xGB6A1RYg0CkvhzLLpf3RlEMijruAWSLhUSCtXQ0xkv8xfgqYZRMCgYEAyUNV
/YQf9IvpEOOmDdv7rtrieccQqyK307667zOZPmYJQ5bpkSnxFAgyYCjFjB0WSte/
X35Nm7LrUJ8oET29zD0TFgJ7TDpbmhYZRlqkASPokjn9ke3QlQyvUf7J2sHcExdq
KVOcHxRmqflLPwMj1cCWYdWJXDegUCiXa9lj7DsCgYEAuQYhYFRmd+k4AQoVfip6
0T9Lw7tDVmBecSWY4CmDg7EvYKWhI0Kp2MS0qBE5QsoBJ4DjMvaLiYWu3Ct0u9aK
iiMNLnKLY1UEal+G4TVUPSIcPVpJT5bASQa+gV15wa5R45lDRwrPZ8VnapHpMOhD
P/R6HHOLwtc8rlV7gP6icKUCgYBYNf8WYjZvRHMeR+ib4nLpLF5e6XTQzSKs18eu
13qu8qHU0ewFB9D16rHJm5UZ2BXRL8Zc4Eq7lyuz5k31YI4zWgFngCbyPhGv80eY
olmHdmmUzX3p28Wzzh95XKa0DouagoSxIEgpBxQII49rSsEGCqbesmzF0kudVm0n
g9xbyQKBgQC8nlRI3L1U4KkPl4nGICFCgygFQxMsZMgW/4CDaOYmfxshwjiXCgMQ
7CgGLQjcFKonGe3tyazayR5+V94svEiaIDt/Dof1Yjp6hmCwReAwwKYo/KaoGiKv
rAH0tz+nUAYAzK092qAun9TOtaamVpbslmKn92AlS087MNCSFQBXYQ==
-----END RSA PRIVATE KEY-----"""

    key_path = "temp_sync_key.key"
    with open(key_path, "w") as f:
        f.write(key_content.strip() + "\n")

    try:
        import getpass
        username = getpass.getuser()
        domain = os.environ.get("USERDOMAIN", "")
        identity = f"{domain}\\{username}" if domain else username
        subprocess.run(["icacls", key_path, "/inheritance:r"], stdout=subprocess.DEVNULL)
        subprocess.run(["icacls", key_path, "/grant:r", f"{identity}:F"], stdout=subprocess.DEVNULL)

        ip = '84.8.148.216'
        user = 'ubuntu'
        base_dir = os.path.dirname(os.path.abspath(__file__))
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
    finally:
        if os.path.exists(key_path):
            os.remove(key_path)

def upload_database_to_remote():
    print("[SYNC] Lokal SQLite verilenler bazasi uzak merkezi servere (84.8.148.216) yuklenir...")
    
    key_content = """-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAn6XItsoash9Cr1yD4Doxsmps9LisPUfLnyc65cceyBXMEyV2
jkPRRxDdtLBM5WA378+JjDbYLJCZwyQmOOYAbXn3SJHTbqrNxjsairI3EK+sYXbz
HmxYpS00owvjfcAYIbiOBM7L2w/+BnInkQo3EkfccE9zYW7PMHx70WYLKVGNTbod
pUvZy8SWH51zJ6jy4x+US6OkEg6TW73mrCsWEgvl7O/9gvYb0XFyChBSRe9W9mW1
I0jTPP7Vk/LP2reZ5Locz97j8nUIVp0nmuB2abQi5ucssVbAYNxRX/mb6mog4cqa
aTdT+xV7yov3EwK7sfziAM0Id8gpclReH6XPYQIDAQABAoIBABb3box9PqHpRVqc
4IvdU1DrZok+F+ko7u4SYrKzloYKPLV0aj3FG9IxZvObeTR2RxXEsXDuYuLmWnhs
NuNwkxcsuJpEADqnb7rYvdS+FpXb79yFlCwIQihg/HWIPE3W2KHhPu0KIuF8x3p9
6Zs/8PQ8SkYN5/dYTY4YGmfhWjGzQ4n79dCO+K8GG7NKUFbeDsRQJEq5Q6rEhyox
5ITK+12ndzYF1oGXdQs66PJrVx93VLSBTTqGcuS9UAV1QMJqOU78zyOGvUlY9ILp
pMG90LnebsuhzNppKhfpVDePmn58IKWTt9HdMh3l1fkf9aohf/glyMKpJPOb4jjP
HwWGOJECgYEAyxEHs5yIucANoCHYO+HSsVc6zmlFJA2i8SzlBkcqHPMTHqg3ZKbX
cz1awuHvmy5t144/wdPNWAldWvTdsQut/80Q+Yrd+h6ta1K0HOVdvDSMcXKSRE1o
SX5xGB6A1RYg0CkvhzLLpf3RlEMijruAWSLhUSCtXQ0xkv8xfgqYZRMCgYEAyUNV
/YQf9IvpEOOmDdv7rtrieccQqyK307667zOZPmYJQ5bpkSnxFAgyYCjFjB0WSte/
X35Nm7LrUJ8oET29zD0TFgJ7TDpbmhYZRlqkASPokjn9ke3QlQyvUf7J2sHcExdq
KVOcHxRmqflLPwMj1cCWYdWJXDegUCiXa9lj7DsCgYEAuQYhYFRmd+k4AQoVfip6
0T9Lw7tDVmBecSWY4CmDg7EvYKWhI0Kp2MS0qBE5QsoBJ4DjMvaLiYWu3Ct0u9aK
iiMNLnKLY1UEal+G4TVUPSIcPVpJT5bASQa+gV15wa5R45lDRwrPZ8VnapHpMOhD
P/R6HHOLwtc8rlV7gP6icKUCgYBYNf8WYjZvRHMeR+ib4nLpLF5e6XTQzSKs18eu
13qu8qHU0ewFB9D16rHJm5UZ2BXRL8Zc4Eq7lyuz5k31YI4zWgFngCbyPhGv80eY
olmHdmmUzX3p28Wzzh95XKa0DouagoSxIEgpBxQII49rSsEGCqbesmzF0kudVm0n
g9xbyQKBgQC8nlRI3L1U4KkPl4nGICFCgygFQxMsZMgW/4CDaOYmfxshwjiXCgMQ
7CgGLQjcFKonGe3tyazayR5+V94svEiaIDt/Dof1Yjp6hmCwReAwwKYo/KaoGiKv
rAH0tz+nUAYAzK092qAun9TOtaamVpbslmKn92AlS087MNCSFQBXYQ==
-----END RSA PRIVATE KEY-----"""

    key_path = "temp_sync_key.key"
    with open(key_path, "w") as f:
        f.write(key_content.strip() + "\n")

    try:
        import getpass
        username = getpass.getuser()
        domain = os.environ.get("USERDOMAIN", "")
        identity = f"{domain}\\{username}" if domain else username
        subprocess.run(["icacls", key_path, "/inheritance:r"], stdout=subprocess.DEVNULL)
        subprocess.run(["icacls", key_path, "/grant:r", f"{identity}:F"], stdout=subprocess.DEVNULL)

        ip = '84.8.148.216'
        user = 'ubuntu'
        base_dir = os.path.dirname(os.path.abspath(__file__))
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
    finally:
        if os.path.exists(key_path):
            os.remove(key_path)

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
