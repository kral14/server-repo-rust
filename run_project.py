import os
import subprocess
import sys

def kill_previous_instances():
    print("[INFO] Evvelki server prosesleri yoxlanilir ve dayandirilir...")
    try:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/F', '/IM', 'coolify-rust.exe', '/T'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            subprocess.run(['pkill', '-f', 'coolify-rust'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def main():
    # Layihənin yerləşdiyi qovluğu tapırıq (coolify-rust)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.join(base_dir, 'coolify-rust')
    
    if not os.path.exists(project_dir):
        print(f"[X] Xeta: '{project_dir}' qovlugu tapilmadi.")
        sys.exit(1)

    kill_previous_instances()

    print(">> Layihe yigilir ve ise salinir (cargo run)...")
    print("Zehmet olmasa, serverin qalxmasini gozleyin.\n" + "-"*40)
    
    try:
        # 'cargo run' əmrini işə salırıq və çıxışı ekrana veririk
        process = subprocess.Popen(
            ["cargo", "run"],
            cwd=project_dir,
            stdout=sys.stdout,
            stderr=sys.stderr,
            text=True
        )
        
        # Proses bitənə qədər gözləyirik
        process.wait()
        
    except KeyboardInterrupt:
        print("\n[STOP] Istifadeci terefinden server dayandirildi.")
    except FileNotFoundError:
        print("[X] Xeta: 'cargo' emri tapilmadi. Rust-in qurasdirildigindan emin olun.")
    except Exception as e:
        print(f"[X] Gozlenilmez xeta bas verdi: {e}")

if __name__ == "__main__":
    main()
