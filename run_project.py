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

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.join(base_dir, 'masterdeploy-rust')
    src_dir = os.path.join(project_dir, 'src')
    
    if not os.path.exists(project_dir):
        print(f"[X] Xeta: '{project_dir}' qovlugu tapilmadi.")
        sys.exit(1)

    kill_previous_instances()

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
    except FileNotFoundError:
        print("[X] Xeta: 'cargo' ve ya 'tauri' emri tapilmadi. Qurasdirildiqlarindan emin olun.")
    except Exception as e:
        print(f"[X] Gozlenilmez xeta bas verdi: {e}")

if __name__ == "__main__":
    main()
