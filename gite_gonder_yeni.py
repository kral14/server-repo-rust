import os
import subprocess
import shutil

REPO_URL = "https://github.com/kral14/server-repo-rust.git"
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

def run_cmd(cmd, ignore_error=False):
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=ROOT_DIR, capture_output=True, text=True)
    if result.returncode != 0 and not ignore_error:
        print(f"Error: {result.stderr}")
    else:
        print(result.stdout)
    return result.returncode == 0

import re

def bump_cargo_version():
    cargo_path = os.path.join(ROOT_DIR, "MasterDeploy-rust", "Cargo.toml")
    if not os.path.exists(cargo_path):
        return None
    with open(cargo_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    match = re.search(r'version\s*=\s*"(\d+)\.(\d+)\.(\d+)"', content)
    if match:
        major, minor, patch = int(match.group(1)), int(match.group(2)), int(match.group(3))
        new_patch = patch + 1
        new_version = f'{major}.{minor}.{new_patch}'
        new_content = content.replace(match.group(0), f'version = "{new_version}"')
        
        with open(cargo_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"BUMPED CARGO VERSION TO: v{new_version}")
        return new_version
    return None

def main():
    print("Preparing to push to server-repo-rust...\n")
    
    # Avtomatik versiya artırılması
    bump_cargo_version()
    
    # 1. Bütün alt .git qovluqlarını silək (submodule xətasının qarşısını almaq üçün)
    for root, dirs, files in os.walk(ROOT_DIR):
        if ".git" in dirs and root != ROOT_DIR:
            git_path = os.path.join(root, ".git")
            print(f"Removing nested git folder: {git_path}")
            try:
                shutil.rmtree(git_path, ignore_errors=True)
            except Exception as e:
                print(f"Failed to remove: {e}")

    # 2. Əsas .git qovluğunu yoxlayırıq, yoxdursa yaradırıq
    main_git = os.path.join(ROOT_DIR, ".git")
    if not os.path.exists(main_git):
        print("Initializing new git repository...")
        run_cmd("git init")
        run_cmd(f"git remote add origin {REPO_URL}")
        run_cmd("git branch -M main")
    else:
        # Remote URL-in mövcud olub-olmadığını yoxlayıb, yoxdursa əlavə edirik
        run_cmd(f"git remote add origin {REPO_URL}", ignore_error=True)
    
    # 3. .gitignore faylını yalnız yoxdursa yaradırıq ki, etdiyiniz dəyişikliklər silinməsin
    gitignore_path = os.path.join(ROOT_DIR, ".gitignore")
    if not os.path.exists(gitignore_path):
        gitignore_content = """
target/
.env
*.pem
*.key
*.db
node_modules/
__pycache__/
*.log
.vscode/
"""
        with open(gitignore_path, "w", encoding="utf-8") as f:
            f.write(gitignore_content.strip())
        print("Created .gitignore")
        
    # 4. Bütün faylları əlavə edib commit edirik
    print("Adding files...")
    if not run_cmd("git add ."):
        print("ERROR: Failed to add files. See output above.")
        return
    
    import datetime
    time_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if not run_cmd(f'git commit -m "Avtomatik yenilenme: {time_str}"', ignore_error=True):
        print("Nothing to commit or commit failed.")
        # We don't return here, maybe there are just no changes
    
    # 5. GitHub-a göndəririk (Normal push, Force (-f) deyil ki tarixçə silinməsin)
    print("Pushing to GitHub, please wait...")
    success = run_cmd("git push origin main")
    
    if success:
        print("\nSUCCESS! All code pushed to GitHub (server-repo-rust) successfully!")
    else:
        print("\nERROR! Something went wrong. Check the logs above.")

if __name__ == "__main__":
    main()
