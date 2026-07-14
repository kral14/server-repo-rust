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
    server_repo_dir = r"c:\Users\nesib\.gemini\antigravity-ide\scratch\mezuniyyet-rust-taurisiz-olan\server-repo-rust"
    main_config_path = os.path.join(server_repo_dir, "..", "config.json")
    server_config_path = os.path.join(server_repo_dir, "config.json")
    
    if not os.path.exists(main_config_path):
        log("XƏTA: Əsas config.json tapılmadı!")
        sys.exit(1)
    if not os.path.exists(server_config_path):
        log("XƏTA: server-repo-rust/config.json tapılmadı!")
        sys.exit(1)
        
    with open(main_config_path, "r", encoding="utf-8") as f:
        main_config = json.load(f)
    with open(server_config_path, "r", encoding="utf-8") as f:
        server_config = json.load(f)
        
    token = main_config.get("github_token", "").strip()
    ip = server_config.get("ip", "").strip()
    user = server_config.get("user", "ubuntu").strip()
    key_path = server_config.get("key", "").strip()
    panel_port = server_config.get("panel_port", "3000").strip()
    
    if not token:
        log("XƏTA: GitHub Token tapılmadı!")
        sys.exit(1)
    if not ip or not key_path:
        log("XƏTA: Server məlumatları (IP və ya SSH Key) tapılmadı!")
        sys.exit(1)
        
    version = bump_cargo_version(server_repo_dir)
    
    # Kodu GitHub-a göndəririk ki, changelog.json və Cargo.toml yenilənsin (MasterDeploy-da yeni versiya görünün)
    log("Kod deyilşiklikləri GitHub-a push edilir...")
    token_url = f"https://oauth2:{token}@github.com/kral14/server-repo-rust.git"
    subprocess.run(f"git remote set-url origin {token_url}", shell=True, cwd=server_repo_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run("git add .", shell=True, cwd=server_repo_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(f'git commit -m "Lokal build yenilenmesi: {version}"', shell=True, cwd=server_repo_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    git_push = subprocess.run("git push origin main", shell=True, cwd=server_repo_dir, capture_output=True, text=True)
    if git_push.returncode != 0:
        log(f"Warning: Git push ugursuz oldu: {git_push.stderr.strip()}")
    else:
        log("✅ Kod ugurla GitHub-a push edildi. Yeni versiya panelinizde gorunecek!")

    log(f"Oxunmuş Məlumatlar:")
    log(f"  - Server IP: {ip}")
    log(f"  - Panel Portu: {panel_port}")
    log(f"  - MasterDeploy Versiyası: {version}")
    log(f"  - SSH Key: {key_path}")
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
