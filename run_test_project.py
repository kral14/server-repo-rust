import os
import subprocess
import sys

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.join(base_dir, 'test-layihe')
    
    if not os.path.exists(project_dir):
        print(f"[X] Xəta: '{project_dir}' qovluğu tapılmadı.")
        sys.exit(1)

    print(">> 'test-layihe' qovluğuna keçid edilir...")
    
    # node_modules yoxdursa, npm install icra edirik
    node_modules_dir = os.path.join(project_dir, 'node_modules')
    if not os.path.exists(node_modules_dir):
        print(">> 'node_modules' tapılmadı, dependency-lər quraşdırılır (npm install)...")
        try:
            # shell=True Windows-da npm əmrini tapmaq üçün lazımdır
            subprocess.run(["npm", "install"], cwd=project_dir, check=True, shell=True)
            print(">> Dependency-lər uğurla quraşdırıldı.\n" + "-"*40)
        except subprocess.CalledProcessError as e:
            print(f"[X] Dependency quraşdırılması zamanı xəta baş verdi: {e}")
            sys.exit(1)
        except FileNotFoundError:
            print("[X] Xəta: 'npm' əmri tapılmadı. Node.js-in quraşdırıldığından emin olun.")
            sys.exit(1)

    # Port olaraq 4000 istifadə edirik (MasterDeploy 3000 portunu istifadə etdiyi üçün)
    env = os.environ.copy()
    env["PORT"] = "4000"

    print(">> Test layihəsi başladılır (node index.js)...")
    print("Sistemə keçid üçün ünvan: http://localhost:4000")
    print("Prosesi dayandırmaq üçün Ctrl+C sıxın.\n" + "-"*40)

    try:
        process = subprocess.Popen(
            ["node", "index.js"],
            cwd=project_dir,
            env=env,
            stdout=sys.stdout,
            stderr=sys.stderr,
            shell=True
        )
        process.wait()
    except KeyboardInterrupt:
        print("\n[STOP] Test layihəsi istifadəçi tərəfindən dayandırıldı.")
    except Exception as e:
        print(f"[X] Gözlənilməz xəta baş verdi: {e}")

if __name__ == "__main__":
    main()
