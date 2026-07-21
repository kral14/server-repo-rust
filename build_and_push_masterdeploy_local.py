import os
import json
import subprocess
import sys
import time
import re

try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

def log(msg):
    safe_msg = msg.replace("ə", "e").replace("ı", "i").replace("ö", "o").replace("ü", "u").replace("ğ", "g").replace("ç", "c").replace("ş", "s")
    safe_msg = safe_msg.replace("Ə", "E").replace("I", "I").replace("Ö", "O").replace("Ü", "U").replace("Ğ", "G").replace("Ç", "C").replace("Ş", "S")
    print(f"[*] {safe_msg}")

def bump_cargo_version(root_dir):
    cargo_path = os.path.join(root_dir, "MasterDeploy-rust", "Cargo.toml")
    if not os.path.exists(cargo_path):
        return "latest"
    try:
        with open(cargo_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        match = re.search(r'version\s*=\s*"(\d+)\.(\d+)\.(\d+)"', content)
        if match:
            major, minor, patch = int(match.group(1)), int(match.group(2)), int(match.group(3))
            new_patch = patch + 1
            new_version = f"{major}.{minor}.{new_patch}"
            new_content = content.replace(match.group(0), f'version = "{new_version}"')
            
            with open(cargo_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            log(f"Versiya artirildi (Bumped): v{new_version}")
            
            # changelog.json yeniləyirik
            changelog_path = os.path.join(root_dir, "MasterDeploy-rust", "static", "changelog.json")
            if os.path.exists(changelog_path):
                try:
                    with open(changelog_path, 'r', encoding='utf-8') as f:
                        logs = json.load(f)
                    
                    v_str = f"v{new_version}"
                    if not any(x.get('version') == v_str for x in logs):
                        new_log = {
                            "version": v_str,
                            "changes": ["Lokal suretli build ve tehlukesizlik tekmillesdirmeleri."]
                        }
                        logs.insert(0, new_log)
                        with open(changelog_path, 'w', encoding='utf-8') as f:
                            json.dump(logs, f, indent=2, ensure_ascii=False)
                        log(f"changelog.json yenilendi: {v_str}")
                except Exception as ex:
                    log(f"Warning: changelog.json yenilenerken xeta: {ex}")
            
            return f"v{new_version}"
    except Exception as e:
        log(f"Warning: Versiya artirilerken xeta: {e}")
    return "latest"

def main():
    log("=== LOKAL MASTERDEPLOY BUILD VƏ DEPLOY SKRİPTİ ===")
    
    # 1. Konfiqurasiyaları oxu
    server_repo_dir = os.path.dirname(os.path.abspath(__file__))
    base_dir = os.path.dirname(server_repo_dir)
    possible_config_paths = [
        os.path.join(base_dir, "config.json"),
        os.path.join(server_repo_dir, "..", "config.json"),
        os.path.join(os.getcwd(), "config.json")
    ]
    main_config_path = None
    for p in possible_config_paths:
        if os.path.exists(p):
            main_config_path = p
            break
            
    if not main_config_path:
        log("XƏTA: Əsas config.json tapılmadı!")
        sys.exit(1)
        
    with open(main_config_path, "r", encoding="utf-8") as f:
        main_config = json.load(f)
        
    token = main_config.get("github_token", "").strip()
    if not token:
        token = os.environ.get("GITHUB_TOKEN", "").strip() or os.environ.get("GH_TOKEN", "").strip()
    if not token:
        possible_token_paths = [
            os.path.join(base_dir, "mezuniyyet", ".env.build"),
            os.path.join(base_dir, ".env.build"),
            os.path.join(base_dir, ".env"),
            os.path.join(base_dir, "github", ".github_token")
        ]
        for tp in possible_token_paths:
            if os.path.exists(tp):
                try:
                    with open(tp, "r", encoding="utf-8") as f:
                        for line in f.read().splitlines():
                            line = line.strip()
                            if line.startswith("GITHUB_TOKEN="):
                                token = line.split("=", 1)[1].strip().strip('"').strip("'")
                                break
                            elif line.startswith("ghp_") or line.startswith("github_pat_"):
                                token = line
                                break
                    if token:
                        break
                except Exception:
                    pass

    if not token:
        log("XƏTA: GitHub Token tapılmadı!")
        sys.exit(1)
        
    token_url = f"https://oauth2:{token}@github.com/kral14/server-repo-rust.git"
    subprocess.run(f"git remote set-url origin {token_url}", shell=True, cwd=server_repo_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run("git checkout main", shell=True, cwd=server_repo_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run("git pull origin main --rebase", shell=True, cwd=server_repo_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    version = bump_cargo_version(server_repo_dir)
    
    # Kodu GitHub-a göndəririk ki, changelog.json və Cargo.toml yenilənsin (MasterDeploy-da yeni versiya görünün)
    log("Kod dəyişiklikləri GitHub-a push edilir...")
    subprocess.run("git add .", shell=True, cwd=server_repo_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(f'git commit -m "Lokal build yenilenmesi: {version}"', shell=True, cwd=server_repo_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    git_push = subprocess.run("git push origin main", shell=True, cwd=server_repo_dir, capture_output=True, text=True)
    if git_push.returncode != 0:
        log(f"Warning: Git push ugursuz oldu: {git_push.stderr.strip()}")
    else:
        log("✅ Kod ugurla GitHub-a push edildi. Yeni versiya panelinizde gorunecek!")
 
    log(f"Oxunmuş Məlumatlar:")
    log(f"  - MasterDeploy Versiyası: {version}")
    log(f"  - GitHub Token: {token[:6]}...{token[-4:]}")
    
    # 2. Local Docker-i GHCR-a login et
    log("Lokal Docker Container Registry-yə (GHCR) daxil edilir...")
    login_cmd = f"echo {token} | docker login ghcr.io -u oauth2 --password-stdin"
    proc = subprocess.run(login_cmd, shell=True, capture_output=True, text=True)
    if proc.returncode != 0:
        log(f"XƏTA: Lokal Docker login uğursuz oldu: {proc.stderr}")
        sys.exit(1)
    log("✅ Lokal Docker uğurla giriş etdi.")
    
    # 3. Docker Buildx ilə MasterDeploy imicini lokal build et və GHCR-a push et
    image_base = "ghcr.io/kral14/server-repo-rust"
    tags = [f"{image_base}:latest"]
    if version != "latest":
        tags.append(f"{image_base}:{version}")
        
    tags_arg = " ".join([f"-t {t}" for t in tags])
    log(f"MasterDeploy lokal olaraq build olunur və push edilir: {tags}...")
    log("Bu proses ilk dəfə uzun çəkə bilər, növbəti dəfələrdə isə target keşləri sayəsində saniyələr alacaq.")
    
    # MasterDeploy-rust qovluğunun kontekstində build edirik
    build_cmd = f"docker buildx build {tags_arg} --push ./MasterDeploy-rust"
    
    start_time = time.time()
    build_proc = subprocess.Popen(build_cmd, shell=True, cwd=server_repo_dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace', bufsize=1, universal_newlines=True)
    
    while True:
        line = build_proc.stdout.readline()
        if not line:
            break
        print(line.rstrip())
        
    build_proc.wait()
    elapsed_time = time.time() - start_time
    
    if build_proc.returncode != 0:
        log(f"❌ XƏTA: Docker build/push prosesi xəta ilə başa çatdı! Kod: {build_proc.returncode}")
        sys.exit(1)
        
    log(f"✅ MasterDeploy imici uğurla build olundu və push edildi! Sərf olunan vaxt: {elapsed_time:.1f} saniyə.")
    
    log("🎉 UĞURLU! MasterDeploy build olundu və GHCR-a göndərildi! Artıq istifadəçi tərəfindən paneldən yenilənə bilər.")

if __name__ == "__main__":
    main()
