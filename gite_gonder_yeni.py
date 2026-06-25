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

def main():
    print("Preparing to push to server-repo-rust...\n")
    
    # 1. Bütün alt .git qovluqlarını silək (submodule xətasının qarşısını almaq üçün)
    for root, dirs, files in os.walk(ROOT_DIR):
        if ".git" in dirs and root != ROOT_DIR:
            git_path = os.path.join(root, ".git")
            print(f"Removing nested git folder: {git_path}")
            try:
                shutil.rmtree(git_path, ignore_errors=True)
            except Exception as e:
                print(f"Failed to remove: {e}")

    # 2. Əsas .git qovluğunu da sıfırlayaq ki, təmiz başlayaq
    main_git = os.path.join(ROOT_DIR, ".git")
    if os.path.exists(main_git):
        print("Resetting main git folder...")
        shutil.rmtree(main_git, ignore_errors=True)
    
    # 3. Yeni git repozitoriyası yaradırıq
    run_cmd("git init")
    
    # 4. .gitignore faylını yeniləyirik
    gitignore_content = """
target/
.env
coolify.db
*.pem
*.key
node_modules/
__pycache__/
*.log
.vscode/
"""
    with open(os.path.join(ROOT_DIR, ".gitignore"), "w", encoding="utf-8") as f:
        f.write(gitignore_content.strip())
    print("Created .gitignore")
        
    # 5. Remote URL əlavə edirik
    run_cmd(f"git remote add origin {REPO_URL}")
    run_cmd("git branch -M main")
    
    # 6. Bütün faylları əlavə edib commit edirik
    print("Adding files...")
    run_cmd("git add .")
    run_cmd('git commit -m "Initial commit for Server Repo Rust"')
    
    # 7. GitHub-a göndəririk (Force push)
    print("Pushing to GitHub, please wait...")
    success = run_cmd("git push -u origin main -f")
    
    if success:
        print("\nSUCCESS! All code pushed to GitHub (server-repo-rust) successfully!")
    else:
        print("\nERROR! Something went wrong. Check the logs above.")

if __name__ == "__main__":
    main()
