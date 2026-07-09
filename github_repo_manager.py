import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import urllib.request
import urllib.error
import json
import os
import subprocess

CONFIG_FILE = "repo_manager_config.json"

class GitHubManagerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("GitHub Repo Manager Pro")
        self.root.geometry("650x650")
        
        self.all_repos = []
        self.config = self.load_config()
        
        # Styles
        style = ttk.Style()
        style.theme_use('clam')
        
        # Main Frame
        main_frame = ttk.Frame(root, padding="15")
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Token Entry
        ttk.Label(main_frame, text="GitHub Personal Access Token (PAT):").grid(row=0, column=0, sticky=tk.W, pady=2)
        self.token_var = tk.StringVar(value=self.config.get("token", ""))
        self.token_entry = ttk.Entry(main_frame, textvariable=self.token_var, show="*", width=50)
        self.token_entry.grid(row=1, column=0, columnspan=2, sticky=tk.EW, pady=5)
        
        # Fetch Repos Button
        self.fetch_btn = ttk.Button(main_frame, text="Repoları Listələ", command=self.fetch_repos)
        self.fetch_btn.grid(row=1, column=2, padx=5, pady=5)
        
        # Search Box
        ttk.Label(main_frame, text="Repolarda Axtarış:").grid(row=2, column=0, sticky=tk.W, pady=2)
        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", self.filter_repos)
        self.search_entry = ttk.Entry(main_frame, textvariable=self.search_var, width=50)
        self.search_entry.grid(row=3, column=0, columnspan=3, sticky=tk.EW, pady=5)
        
        # Repos Dropdown
        ttk.Label(main_frame, text="Mövcud Repolarınız:").grid(row=4, column=0, sticky=tk.W, pady=2)
        self.repo_var = tk.StringVar()
        self.repo_combo = ttk.Combobox(main_frame, textvariable=self.repo_var, state="readonly", width=47)
        self.repo_combo.grid(row=5, column=0, columnspan=3, sticky=tk.EW, pady=5)
        self.repo_combo.bind("<<ComboboxSelected>>", self.on_repo_select)
        
        # Action Frame
        action_frame = ttk.LabelFrame(main_frame, text="Əməliyyatlar", padding="10")
        action_frame.grid(row=6, column=0, columnspan=3, sticky=tk.EW, pady=15)
        
        # Clean Repo Button
        self.clean_btn = ttk.Button(action_frame, text="🚨 Reponun İçini Tamamilə Sil (Təmizlə)", command=self.clean_repo)
        self.clean_btn.pack(fill=tk.X, pady=5)
        
        # Push Directory Frame
        push_dir_frame = ttk.Frame(action_frame)
        push_dir_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(push_dir_frame, text="Push ediləcək Yerli Qovluq:").pack(side=tk.LEFT, padx=2)
        self.local_dir_var = tk.StringVar(value=self.config.get("last_dir", ""))
        self.local_dir_entry = ttk.Entry(push_dir_frame, textvariable=self.local_dir_var, width=30)
        self.local_dir_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2)
        
        self.browse_btn = ttk.Button(push_dir_frame, text="Seç...", command=self.browse_directory)
        self.browse_btn.pack(side=tk.RIGHT, padx=2)
        
        # Push Directory Action Button
        self.push_dir_btn = ttk.Button(action_frame, text="📂 Seçilən Qovluğu Repoya Push Et", command=self.push_selected_directory)
        self.push_dir_btn.pack(fill=tk.X, pady=5)
        
        # Clone / Pull Action
        self.clone_btn = ttk.Button(action_frame, text="Clone / Pull Et", command=self.git_pull)
        self.clone_btn.pack(fill=tk.X, pady=5)
        
        # Terminal Log View
        ttk.Label(main_frame, text="Konsol Çıxışı:").grid(row=7, column=0, sticky=tk.W, pady=2)
        self.log_text = tk.Text(main_frame, height=10, bg="#1e1e1e", fg="#00ff00", insertbackground="white")
        self.log_text.grid(row=8, column=0, columnspan=3, sticky=tk.NSEW, pady=5)
        
        # Configure weights
        main_frame.rowconfigure(8, weight=1)
        main_frame.columnconfigure(1, weight=1)
        
        # Auto-load repos if token is saved
        if self.token_var.get().strip():
            self.fetch_repos()

    def load_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    return json.load(f)
            except:
                pass
        return {}

    def save_config(self):
        config = {
            "token": self.token_var.get().strip(),
            "last_repo": self.repo_var.get(),
            "last_dir": self.local_dir_var.get()
        }
        try:
            with open(CONFIG_FILE, "w") as f:
                json.dump(config, f)
        except Exception as e:
            self.log(f"Config saxlanarkən xəta: {e}")

    def log(self, message):
        self.log_text.insert(tk.END, message + "\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()

    def get_headers(self):
        token = self.token_var.get().strip()
        return {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "GitHub-Repo-Manager-App"
        }

    def fetch_repos(self):
        self.log("Repolar siyahısı alınır...")
        url = "https://api.github.com/user/repos?per_page=100&type=owner"
        req = urllib.request.Request(url, headers=self.get_headers())
        try:
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode())
                self.all_repos = [repo["full_name"] for repo in data]
                self.filter_repos()
                self.save_config()
                
                # Restore last selected repo if present
                last_repo = self.config.get("last_repo")
                if last_repo in self.all_repos:
                    self.repo_combo.set(last_repo)
                elif self.all_repos:
                    self.repo_combo.current(0)
                    
                self.log(f"Uğurlu! {len(self.all_repos)} repo tapıldı.")
        except Exception as e:
            self.log(f"Xəta baş verdi: {e}")
            messagebox.showerror("Xəta", f"Repoları oxumaq mümkün olmadı: {e}")

    def filter_repos(self, *args):
        query = self.search_var.get().lower().strip()
        filtered = [r for r in self.all_repos if query in r.lower()]
        self.repo_combo['values'] = filtered
        if filtered:
            # Pəncərə açılan vaxt mövcud seçimi saxlamaq üçün yoxlama
            current_val = self.repo_var.get()
            if current_val not in filtered:
                self.repo_combo.current(0)

    def on_repo_select(self, event):
        self.save_config()

    def browse_directory(self):
        dir_path = filedialog.askdirectory(initialdir=os.getcwd())
        if dir_path:
            self.local_dir_var.set(dir_path)
            self.save_config()

    def clean_repo(self):
        repo = self.repo_var.get()
        if not repo:
            messagebox.showwarning("Xəbərdarlıq", "Zəhmət olmasa siyahıdan repo seçin!")
            return
        
        if not messagebox.askyesno("Təsdiq", f"Diqqət! '{repo}' reposundakı BÜTÜN fayllar silinəcək və repo boşaldılacaq. Davam edilsin?"):
            return
            
        token = self.token_var.get().strip()
        self.log(f"'{repo}' reposunun təmizlənməsi başladı...")
        
        temp_dir = os.path.join(os.getcwd(), "temp_git_clean")
        try:
            if os.path.exists(temp_dir):
                subprocess.run(["powershell", "-Command", f"Remove-Item -Recurse -Force '{temp_dir}'"], shell=True)
            os.makedirs(temp_dir, exist_ok=True)
            
            subprocess.run(["git", "init"], cwd=temp_dir, check=True)
            subprocess.run(["git", "checkout", "-b", "main"], cwd=temp_dir, check=True)
            
            with open(os.path.join(temp_dir, "README.md"), "w") as f:
                f.write(f"# {repo.split('/')[-1]}\nRepo cleaned up.")
                
            subprocess.run(["git", "add", "README.md"], cwd=temp_dir, check=True)
            subprocess.run(["git", "commit", "-m", "Clean repository"], cwd=temp_dir, check=True)
            
            auth_url = f"https://oauth2:{token}@github.com/{repo}.git"
            self.log("Boş commit GitHub-a göndərilir (Force Push)...")
            res = subprocess.run(["git", "push", auth_url, "main", "--force"], cwd=temp_dir, capture_output=True, text=True)
            
            if res.returncode == 0:
                self.log("✅ Repo uğurla təmizləndi!")
                messagebox.showinfo("Uğurlu", "Reponun içi uğurla silindi!")
            else:
                self.log(f"❌ Push xətası: {res.stderr}")
        except Exception as e:
            self.log(f"Xəta: {e}")
        finally:
            if os.path.exists(temp_dir):
                subprocess.run(["powershell", "-Command", f"Remove-Item -Recurse -Force '{temp_dir}'"], shell=True)

    def push_selected_directory(self):
        repo = self.repo_var.get()
        local_dir = self.local_dir_var.get().strip()
        token = self.token_var.get().strip()
        
        if not repo or not local_dir or not token:
            messagebox.showwarning("Xəbərdarlıq", "Zəhmət olmasa Repo, Token və Yerli Qovluğu seçin!")
            return
            
        if not os.path.exists(local_dir):
            messagebox.showerror("Xəta", "Seçilmiş qovluq mövcud deyil!")
            return
            
        self.log(f"'{local_dir}' qovluğundakı fayllar '{repo}' reposuna push edilir...")
        
        try:
            # Həmin qovluqda git reposunun olub-olmadığını yoxlayaq
            git_dir = os.path.join(local_dir, ".git")
            if not os.path.exists(git_dir):
                subprocess.run(["git", "init"], cwd=local_dir, check=True)
                subprocess.run(["git", "checkout", "-b", "main"], cwd=local_dir, check=True)
            
            subprocess.run(["git", "add", "."], cwd=local_dir, check=True)
            
            # Commit mesajı üçün input pəncərəsi yoxdur, sadəcə default yazaq
            subprocess.run(["git", "commit", "-m", "Push via GitHub Repo Manager Pro"], cwd=local_dir)
            
            auth_url = f"https://oauth2:{token}@github.com/{repo}.git"
            self.log("Fayllar GitHub-a göndərilir...")
            res = subprocess.run(["git", "push", auth_url, "main", "--force"], cwd=local_dir, capture_output=True, text=True)
            
            if res.returncode == 0:
                self.log("✅ Qovluq uğurla Push edildi!")
                messagebox.showinfo("Uğurlu", "Qovluqdakı fayllar uğurla göndərildi!")
            else:
                self.log(f"❌ Push xətası: {res.stderr}")
        except Exception as e:
            self.log(f"Xəta: {e}")
            messagebox.showerror("Xəta", f"Push etmək mümkün olmadı: {e}")

    def git_pull(self):
        repo = self.repo_var.get()
        if not repo:
            messagebox.showwarning("Seçin", "Repo seçin!")
            return
        token = self.token_var.get().strip()
        
        local_path = os.path.join(os.getcwd(), repo.split('/')[-1])
        self.log(f"Klonlanır/Yenilənir: {local_path}")
        
        auth_url = f"https://oauth2:{token}@github.com/{repo}.git"
        if not os.path.exists(local_path):
            res = subprocess.run(["git", "clone", auth_url, local_path], capture_output=True, text=True)
        else:
            res = subprocess.run(["git", "pull"], cwd=local_path, capture_output=True, text=True)
            
        if res.returncode == 0:
            self.log("✅ Clone/Pull uğurlu!")
        else:
            self.log(f"❌ Xəta: {res.stderr}")

if __name__ == "__main__":
    root = tk.Tk()
    app = GitHubManagerApp(root)
    root.mainloop()
