import os
import json
import subprocess
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

# Rəng Palitrası (Dark Mode)
BG_COLOR = "#121212"
CARD_COLOR = "#1E1E1E"
TEXT_COLOR = "#E0E0E0"
ACCENT_COLOR = "#00D2FF"
ENTRY_BG = "#2D2D2D"
BTN_CHECK = "#F39C12"
BTN_PREP = "#3498DB"
BTN_PANEL = "#9B59B6"
BTN_ALL = "#2ECC71"
BTN_REBOOT = "#F1C40F"
BTN_CLEAN = "#E74C3C"

class RemoteInstallerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("MasterDeploy Uzaqdan Quraşdırıcı 🚀")
        self.root.geometry("800x700")
        self.root.configure(bg=BG_COLOR, padx=30, pady=20)
        
        # Fontlar
        font_title = ("Segoe UI", 18, "bold")
        font_label = ("Segoe UI", 10, "bold")
        font_entry = ("Segoe UI", 10)
        font_btn = ("Segoe UI", 9, "bold")
        font_console = ("Consolas", 9)

        # --- Başlıq ---
        tk.Label(root, text="MİNİ-COOLİFY UZAQDAN İDARƏETMƏ", font=font_title, bg=BG_COLOR, fg=ACCENT_COLOR).pack(pady=(0, 10))
        
        # --- Notebook (Tabs) ---
        style = ttk.Style()
        style.theme_use('default')
        style.configure('TNotebook.Tab', font=font_label, padding=[10, 5])
        
        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill=tk.BOTH, expand=True)
        
        self.tab_main = tk.Frame(self.notebook, bg=BG_COLOR)
        self.tab_term = tk.Frame(self.notebook, bg=BG_COLOR)
        
        self.notebook.add(self.tab_main, text="🛠️ İdarəetmə")
        self.notebook.add(self.tab_term, text="💻 Terminal (Gözləyir...)")
        
        # --- Giriş Forması (Kart Dizaynı) ---
        form_frame = tk.Frame(self.tab_main, bg=CARD_COLOR, bd=0, relief=tk.FLAT, highlightbackground="#333", highlightthickness=1)
        form_frame.pack(fill=tk.X, pady=10, ipady=15, ipadx=15)
        
        # IP
        tk.Label(form_frame, text="Server IP-si:", font=font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=0, column=0, sticky=tk.W, pady=8, padx=10)
        self.ip_entry = tk.Entry(form_frame, width=35, font=font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.ip_entry.grid(row=0, column=1, pady=8, padx=10, ipady=4)
        
        # User
        tk.Label(form_frame, text="SSH İstifadəçi adı:", font=font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=1, column=0, sticky=tk.W, pady=8, padx=10)
        self.user_entry = tk.Entry(form_frame, width=35, font=font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.user_entry.insert(0, "ubuntu")
        self.user_entry.grid(row=1, column=1, pady=8, padx=10, ipady=4)
        
        # SSH Key
        tk.Label(form_frame, text="SSH Açarı (.key / .pem):", font=font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=2, column=0, sticky=tk.W, pady=8, padx=10)
        key_frame = tk.Frame(form_frame, bg=CARD_COLOR)
        key_frame.grid(row=2, column=1, sticky=tk.W, padx=10)
        self.key_entry = tk.Entry(key_frame, width=27, font=font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.key_entry.pack(side=tk.LEFT, ipady=4)
        
        def create_button(parent, text, bg_color, command, **kwargs):
            fg_color = kwargs.pop("fg", "white")
            btn = tk.Button(parent, text=text, bg=bg_color, fg=fg_color, font=font_btn, 
                            relief=tk.FLAT, borderwidth=0, cursor="hand2", 
                            activebackground="#555", activeforeground="white", command=command, **kwargs)
            return btn

        create_button(key_frame, "Seç", "#555", self.browse_key).pack(side=tk.LEFT, padx=10, ipady=2, ipadx=10)

        # Swap
        tk.Label(form_frame, text="Swap Həcmi (GB):", font=font_label, bg=CARD_COLOR, fg=BTN_CHECK).grid(row=3, column=0, sticky=tk.W, pady=8, padx=10)
        self.swap_entry = tk.Entry(form_frame, width=15, font=font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.swap_entry.grid(row=3, column=1, sticky=tk.W, pady=8, padx=10, ipady=4)
        
        self.load_config()

        # --- Əsas Düymələr ---
        btn_frame = tk.Frame(self.tab_main, bg=BG_COLOR)
        btn_frame.pack(fill=tk.X, pady=15)
        
        self.btn_check = create_button(btn_frame, "🔗 Qoşulmanı Yoxla", BTN_CHECK, self.test_connection)
        self.btn_check.grid(row=0, column=0, padx=5, ipady=5, ipadx=5)
        
        self.btn_prep = create_button(btn_frame, "🛠️ Serveri Hazırla (Swap+Docker)", BTN_PREP, lambda: self.run_task(self.install_swap_and_docker))
        self.btn_prep.grid(row=0, column=1, padx=5, ipady=5, ipadx=5)
        
        self.btn_panel = create_button(btn_frame, "🚀 Paneli Qur", BTN_PANEL, lambda: self.run_task(self.install_masterdeploy))
        self.btn_panel.grid(row=0, column=2, padx=5, ipady=5, ipadx=5)
        
        self.btn_all = create_button(btn_frame, "🌟 Hepsini Qur (Tam)", BTN_ALL, lambda: self.run_task(self.install_all))
        self.btn_all.grid(row=0, column=3, padx=5, ipady=5, ipadx=5)
        
        # --- Əlavə Düymələr ---
        extra_btn_frame = tk.Frame(self.tab_main, bg=BG_COLOR)
        extra_btn_frame.pack(fill=tk.X, pady=5)

        self.btn_reboot = create_button(extra_btn_frame, "🔄 Restart", BTN_REBOOT, lambda: self.run_task(self.reboot_server), fg="black")
        self.btn_reboot.grid(row=0, column=0, padx=5, ipady=4, ipadx=10)
        
        self.btn_clean = create_button(extra_btn_frame, "🗑️ Otağı Təmizlə", BTN_CLEAN, lambda: self.run_task(self.clean_server))
        self.btn_clean.grid(row=0, column=1, padx=5, ipady=4, ipadx=10)

        self.btn_portainer = create_button(extra_btn_frame, "🐳 Portainer Qur", "#00A2D3", lambda: self.run_task(self.install_portainer))
        self.btn_portainer.grid(row=0, column=2, padx=5, ipady=4, ipadx=10)

        # Düymələri Disable etmək üçün helper
        self.action_btns = [self.btn_prep, self.btn_panel, self.btn_all, self.btn_reboot, self.btn_clean, self.btn_portainer]
        self.toggle_buttons(tk.DISABLED)

        # --- Monitor Forması ---
        self.monitor_frame = tk.Frame(self.tab_main, bg="#111111", highlightbackground="#00FF00", highlightthickness=1)
        
        # CPU
        self.lbl_cpu = tk.Label(self.monitor_frame, text="CPU Yükü: --", bg="#111111", fg="#00FF00", font=("Consolas", 10, "bold"))
        self.lbl_cpu.pack(side=tk.LEFT, expand=True, pady=5)
        # RAM
        self.lbl_ram = tk.Label(self.monitor_frame, text="RAM: -- / --", bg="#111111", fg="#00FF00", font=("Consolas", 10, "bold"))
        self.lbl_ram.pack(side=tk.LEFT, expand=True, pady=5)
        # SWAP
        self.lbl_swap = tk.Label(self.monitor_frame, text="SWAP: -- / --", bg="#111111", fg="#00FF00", font=("Consolas", 10, "bold"))
        self.lbl_swap.pack(side=tk.LEFT, expand=True, pady=5)
        
        self.monitoring_active = False

        # --- Konsol Çıxışı (Tab 2) ---
        self.console_header = tk.Frame(self.tab_term, bg=BG_COLOR)
        self.console_header.pack(fill=tk.X, pady=(15, 5))
        tk.Label(self.console_header, text="Terminal Çıxışı:", font=font_label, bg=BG_COLOR, fg=ACCENT_COLOR).pack(side=tk.LEFT)
        create_button(self.console_header, "📄 Çıxışı Kopyala", "#444", self.copy_console).pack(side=tk.RIGHT, ipady=2, ipadx=10)

        # Terminal Box
        terminal_frame = tk.Frame(self.tab_term, bg=ACCENT_COLOR, bd=1)
        terminal_frame.pack(fill=tk.BOTH, expand=True)
        self.console = scrolledtext.ScrolledText(terminal_frame, width=80, height=15, bg="#0A0A0A", fg="#00FF00", font=font_console, relief=tk.FLAT, padx=10, pady=10)
        self.console.pack(fill=tk.BOTH, expand=True)
        
        # Auto-Check Connection if config loaded
        if self.ip_entry.get() and self.key_entry.get():
            self.root.after(500, self.auto_check_connection)

    def load_config(self):
        try:
            if os.path.exists("config.json"):
                with open("config.json", "r") as f:
                    data = json.load(f)
                    self.ip_entry.insert(0, data.get("ip", ""))
                    self.user_entry.delete(0, tk.END)
                    self.user_entry.insert(0, data.get("user", "ubuntu"))
                    self.key_entry.insert(0, data.get("key", ""))
                    self.swap_entry.delete(0, tk.END)
                    self.swap_entry.insert(0, data.get("swap", "2"))
            else:
                self.user_entry.insert(0, "ubuntu")
                self.swap_entry.insert(0, "2")
        except Exception:
            pass

    def save_config(self):
        try:
            data = {
                "ip": self.ip_entry.get().strip(),
                "user": self.user_entry.get().strip(),
                "key": self.key_entry.get().strip(),
                "swap": self.swap_entry.get().strip()
            }
            with open("config.json", "w") as f:
                json.dump(data, f)
        except Exception:
            pass

    def auto_check_connection(self):
        self.test_connection(auto=True)

    def toggle_buttons(self, state):
        for btn in self.action_btns:
            btn.config(state=state)
            if state == tk.DISABLED:
                btn.config(bg="#333333", fg="#888888")
            else:
                # Restore original colors based on button identity
                if btn == self.btn_prep: btn.config(bg=BTN_PREP, fg="white")
                elif btn == self.btn_panel: btn.config(bg=BTN_PANEL, fg="white")
                elif btn == self.btn_all: btn.config(bg=BTN_ALL, fg="white")
                elif btn == self.btn_reboot: btn.config(bg=BTN_REBOOT, fg="black")
                elif btn == self.btn_clean: btn.config(bg=BTN_CLEAN, fg="white")

    def copy_console(self):
        text = self.console.get("1.0", tk.END)
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        messagebox.showinfo("Kopyalandı", "Terminal çıxışı yaddaşa (clipboard) kopyalandı!")

    def browse_key(self):
        filename = filedialog.askopenfilename(title="SSH Açarını Seç", filetypes=[("Key Files", "*.key *.pem"), ("All Files", "*.*")])
        if filename:
            self.key_entry.delete(0, tk.END)
            self.key_entry.insert(0, filename)

    def log(self, message):
        self.console.insert(tk.END, message + "\n")
        self.console.see(tk.END)
        self.root.update_idletasks()
        
    def update_terminal_tab_title(self, is_running):
        if is_running:
            self.notebook.tab(1, text="💻 Terminal (🟢 İşləyir)")
        else:
            self.notebook.tab(1, text="💻 Terminal (Boş)")

    def fix_key_permissions(self, key_path):
        if os.name == 'nt':
            try:
                domain = os.environ.get("USERDOMAIN", "")
                username = os.environ.get("USERNAME", "")
                if not username:
                    import getpass
                    username = getpass.getuser()
                
                identity = f"{domain}\\{username}" if domain else username
                
                # İcazələri sıfırlayırıq və yalnız cari istifadəçiyə tam hüquq veririk
                subprocess.run(["icacls", key_path, "/inheritance:r"], capture_output=True)
                subprocess.run(["icacls", key_path, "/grant:r", f"{identity}:F"], capture_output=True)
            except Exception as e:
                self.log(f"[XƏBƏRDARLIQ] Açar icazələri avtomatik dəyişdirilə bilmədi: {e}")

    def run_ssh_command(self, ip, user, key_path, command):
        self.fix_key_permissions(key_path)
        ssh_cmd = [
            "ssh",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=10",
            "-i", key_path,
            f"{user}@{ip}",
            command
        ]
        try:
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            process = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', creationflags=creationflags)
            
            if process.stdout:
                for line in process.stdout.strip().split('\\n'):
                    if line:
                        self.root.after(0, self.log, line)
            
            if process.returncode != 0:
                self.root.after(0, self.log, f"[SSH XƏTASI] (Kodu: {process.returncode})")
                return False
            return True
        except Exception as e:
            self.root.after(0, self.log, f"[SİSTEM XƏTASI] SSH İcrası uğursuz oldu: {e}")
            return False

    def run_background_task(self, ip, user, key_path, cmd):
        self.fix_key_permissions(key_path)
        
        # Komandanı bash faylına yazırıq və bitəndə markerləri qoyuruq
        full_script = f"""
        cat << 'EOF' > /tmp/task.sh
#!/bin/bash
{{
{cmd}
}} && echo '===TASK_COMPLETED_SUCCESS===' || echo '===TASK_FAILED==='
EOF
        chmod +x /tmp/task.sh
        echo '' > /tmp/mini_masterdeploy.log
        nohup bash /tmp/task.sh >> /tmp/mini_masterdeploy.log 2>&1 &
        """

        ssh_cmd = [
            "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", "-i", key_path, f"{user}@{ip}", full_script
        ]
        
        try:
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            process = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=creationflags)
            process.communicate()
            
            self.log("[BİLGİ] Əməliyyat serverdə arxa planda başladıldı. Pəncərəni bağlasanız belə davam edəcək.")
            self.tail_active = True
            threading.Thread(target=self.tail_logs, args=(ip, user, key_path), daemon=True).start()
        except Exception as e:
            self.log(f"[XƏTA] Arxa plan komandası başlamaq üzrə xəta verdi: {e}")
            self.toggle_buttons(tk.NORMAL)

    def tail_logs(self, ip, user, key_path):
        ssh_cmd = [
            "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ServerAliveInterval=5", "-i", key_path, f"{user}@{ip}",
            "stdbuf -o0 tail -n +1 -F /tmp/mini_masterdeploy.log 2>/dev/null"
        ]
        
        try:
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            process = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0, creationflags=creationflags)
            
            buffer = bytearray()
            while self.tail_active:
                char = process.stdout.read(1)
                if not char:
                    break
                
                if char == b'\r' or char == b'\n':
                    if buffer:
                        line_str = buffer.decode('utf-8', errors='replace')
                        
                        # Stop commands checks
                        if line_str == "===TASK_COMPLETED_SUCCESS===":
                            self.root.after(0, self.log, "✅ ƏMƏLİYYAT UĞURLA BİTDİ!")
                            self.root.after(0, lambda: self.toggle_buttons(tk.NORMAL))
                            self.root.after(0, lambda: self.update_terminal_tab_title(False))
                            process.terminate()
                            break
                        elif line_str == "===TASK_FAILED===":
                            self.root.after(0, self.log, "❌ ƏMƏLİYYAT ZAMANI XƏTA BAŞ VERDİ!")
                            self.root.after(0, lambda: self.toggle_buttons(tk.NORMAL))
                            self.root.after(0, lambda: self.update_terminal_tab_title(False))
                            process.terminate()
                            break
                        else:
                            self.root.after(0, self.log, line_str)
                        buffer.clear()
                else:
                    buffer.extend(char)
                    
            process.wait()
        except Exception:
            self.root.after(0, lambda: self.toggle_buttons(tk.NORMAL))

    def test_connection(self, auto=False):
        ip = self.ip_entry.get().strip()
        user = self.user_entry.get().strip()
        key_path = self.key_entry.get().strip()
        
        if not ip or not user or not key_path:
            if not auto: messagebox.showwarning("Xəta", "Bütün xanaları doldurun!")
            return

        self.save_config()
        self.log(f"\n--- Yoxlanılır: {user}@{ip} ---")
        self.btn_check.config(state=tk.DISABLED, text="Gözləyin...")
        
        def task():
            success = self.run_ssh_command(ip, user, key_path, "echo 'Bağlantı Uğurludur!'")
            if success:
                self.log("✅ QOŞULMA UĞURLUDUR! İndi quraşdırma əməliyyatlarını edə bilərsiniz.")
                self.toggle_buttons(tk.NORMAL)
                if not auto: messagebox.showinfo("Uğurlu", "Serverə qoşulma uğurludur!")
                
                # Monitöru Ekrana gətir və başlat
                self.monitor_frame.pack(fill=tk.X, pady=(0, 10))
                self.start_monitoring()
                
                # Arxa planda işləyən proses varmı yoxla
                self.check_running_task(ip, user, key_path)
            else:
                self.log("❌ QOŞULMA XƏTASI! Zəhmət olmasa IP, İstifadəçi adı və Açarı (Key) düzgün daxil etdiyinizə əmin olun.")
                if not auto: messagebox.showerror("Xəta", "Serverə qoşulmaq mümkün olmadı!")
            
            self.btn_check.config(state=tk.NORMAL, text="🔗 Qoşulmanı Yoxla", bg=BTN_CHECK)

        threading.Thread(target=task, daemon=True).start()

    def check_running_task(self, ip, user, key_path):
        # Arxa planda task.sh işləyirmi? Özünü tapmaması üçün regex [b]ash istifadə edirik
        cmd = "pgrep -f '[b]ash /tmp/task.sh' > /dev/null && echo 'RUNNING' || echo 'STOPPED'"
        ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
        try:
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            out = subprocess.check_output(ssh_cmd, text=True, creationflags=creationflags).strip()
            if out == 'RUNNING':
                self.log("[BİLGİ] Arxa planda davam edən quraşdırma tapıldı! Loqlar canlı izlənilir...")
                self.update_terminal_tab_title(True)
                self.toggle_buttons(tk.DISABLED)
                self.tail_active = True
                threading.Thread(target=self.tail_logs, args=(ip, user, key_path), daemon=True).start()
            else:
                self.update_terminal_tab_title(False)
        except Exception:
            pass

    def run_task_wrapper(self, task_func):
        self.save_config()
        self.toggle_buttons(tk.DISABLED)
        self.update_terminal_tab_title(True)
        # We start the task function directly. The task function will call run_background_task which handles re-enabling buttons on finish.
        threading.Thread(target=task_func, daemon=True).start()

    def run_task(self, task_func):
        # Update run_task to use the wrapper that doesn't automatically enable buttons
        self.run_task_wrapper(task_func)

    def get_creds(self):
        return self.ip_entry.get().strip(), self.user_entry.get().strip(), self.key_entry.get().strip()

    def install_swap_and_docker(self):
        ip, user, key_path = self.get_creds()
        swap_gb = self.swap_entry.get().strip()
        if not swap_gb.isdigit():
            messagebox.showerror("Xəta", "Swap həcmi rəqəm olmalıdır!")
            return
            
        swap_mb = int(swap_gb) * 1024
        self.log(f"\n--- SERVER HAZIRLIĞI BAŞLADI ({ip}) ---")
        
        cmd = f"""
        echo '[1/3] Swap ({swap_gb}GB) Yoxlanılır və Qurulur...';
        if grep -q '/swapfile' /proc/swaps; then
            echo 'Köhnə Swap söndürülür və silinir...';
            sudo swapoff /swapfile;
            sudo rm -f /swapfile;
        fi;
        if [ ! -f /swapfile ]; then
            sudo fallocate -l {swap_gb}G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count={swap_mb};
            sudo chmod 600 /swapfile;
            sudo mkswap /swapfile;
            sudo swapon /swapfile;
            grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab;
            echo 'Yeni {swap_gb}GB Swap quruldu!';
        fi;
        sudo sysctl vm.swappiness=10;
        
        echo '[2/3] Git Yenilənir...';
        if ! command -v git > /dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y git;
        fi;

        echo '[3/3] Docker Yoxlanılır və Qurulur...';
        if ! command -v docker > /dev/null 2>&1; then 
            curl -fsSL https://get.docker.com -o get-docker.sh; 
            sudo sh get-docker.sh; 
            sudo systemctl enable docker; 
            sudo systemctl start docker; 
            sudo usermod -aG docker $USER;
            echo 'Docker uğurla quruldu!';
        else
            echo 'Docker artıq mövcuddur.';
        fi;
        """
        self.run_background_task(ip, user, key_path, cmd)

    def install_masterdeploy(self):
        ip, user, key_path = self.get_creds()
        self.log(f"\n--- MİNİ-COOLİFY QURULUMU BAŞLADI ({ip}) ---")
        
        cmd = """
        echo 'MasterDeploy Qurulur...';
        sudo rm -rf server-repo-rust;
        git clone https://github.com/kral14/server-repo-rust.git;
        cd server-repo-rust/MasterDeploy-rust;
        
        echo 'Portlar açılır (Firewall / Iptables)...';
        sudo iptables -I INPUT -p tcp -m tcp --dport 3000 -j ACCEPT 2>/dev/null || true;
        sudo netfilter-persistent save 2>/dev/null || true;
        sudo ufw allow 3000/tcp 2>/dev/null || true;
        
        echo 'Köhnə panel silinir (əgər varsa)...';
        sudo docker stop masterdeploy 2>/dev/null || true;
        sudo docker rm masterdeploy 2>/dev/null || true;
        
        echo 'Yeni panel yüklənir və işə salınır (GitHub-dan)... Bu cəmi bir neçə saniyə çəkəcək...';
        if ! sudo docker pull ghcr.io/kral14/server-repo-rust:latest; then
            echo '❌ XƏTA: GitHub-dan hazır Docker imicini yükləmək mümkün olmadı!';
            echo 'Məsləhət: GitHub Repo tənzimləmələrində GHCR paketiinizi Public etməyi unutmayın.';
            exit 1;
        fi;
        
        sudo docker run -d --name masterdeploy -p 3000:3000 \
            -v /var/run/docker.sock:/var/run/docker.sock \
            -v /data/masterdeploy:/data/masterdeploy \
            -v ~/.ssh:/root/.ssh \
            --restart unless-stopped ghcr.io/kral14/server-repo-rust:latest;
        
        echo 'Watchtower qurulur (avto-yenileme sistemi)...';
        sudo docker stop watchtower 2>/dev/null || true;
        sudo docker rm watchtower 2>/dev/null || true;
        sudo docker run -d \
            --name watchtower \
            --restart unless-stopped \
            -e DOCKER_API_VERSION=1.40 \
            -e WATCHTOWER_POLL_INTERVAL=60 \
            -v /var/run/docker.sock:/var/run/docker.sock \
            containrrr/watchtower:1.5.3 \
            masterdeploy;
        
        echo '=========================================';
        echo 'PANEL QURULDU! Link: http://'$(curl -s ifconfig.me)':3000';
        echo 'Watchtower aktiv edildi - Panel GitHub-a hər push-dan sonra ozunu yenileyecek!';
        echo '=========================================';
        """
        self.run_background_task(ip, user, key_path, cmd)

    def install_all(self):
        ip, user, key_path = self.get_creds()
        swap_gb = self.swap_entry.get().strip()
        swap_mb = int(swap_gb) * 1024 if swap_gb.isdigit() else 2048
        
        cmd = f"""
        echo '[1/3] Swap ({swap_gb}GB) Yoxlanılır və Qurulur...';
        if [ ! -f /swapfile ]; then
            sudo fallocate -l {swap_gb}G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count={swap_mb};
            sudo chmod 600 /swapfile;
            sudo mkswap /swapfile;
            sudo swapon /swapfile;
            grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab;
        fi;
        sudo sysctl vm.swappiness=10;
        if ! command -v docker > /dev/null 2>&1; then 
            curl -fsSL https://get.docker.com -o get-docker.sh; sudo sh get-docker.sh; 
            sudo systemctl enable docker; sudo systemctl start docker; sudo usermod -aG docker $USER;
        fi;
        if ! command -v git > /dev/null 2>&1; then
            sudo apt-get update && sudo apt-get install -y git;
        fi;
        echo 'MasterDeploy Qurulur...';
        sudo rm -rf server-repo-rust;
        git clone https://github.com/kral14/server-repo-rust.git;
        cd server-repo-rust/MasterDeploy-rust;
        sudo iptables -I INPUT -p tcp -m tcp --dport 3000 -j ACCEPT 2>/dev/null || true;
        sudo ufw allow 3000/tcp 2>/dev/null || true;
        sudo docker stop masterdeploy 2>/dev/null || true;
        sudo docker rm masterdeploy 2>/dev/null || true;
        sudo docker build -t masterdeploy-app . && \
        sudo docker run -d --name masterdeploy -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock -v /data/masterdeploy:/data/masterdeploy -v ~/.ssh:/root/.ssh --restart unless-stopped masterdeploy-app;
        
        echo 'Watchtower qurulur (avto-yenileme sistemi)...';
        sudo docker stop watchtower 2>/dev/null || true;
        sudo docker rm watchtower 2>/dev/null || true;
        sudo docker run -d \
            --name watchtower \
            --restart unless-stopped \
            -v /var/run/docker.sock:/var/run/docker.sock \
            containrrr/watchtower \
            --interval 60 \
            masterdeploy;
        
        echo '=========================================';
        echo 'PANEL QURULDU! Link: http://'$(curl -s ifconfig.me)':3000';
        echo 'Watchtower aktiv edildi - Panel GitHub-a her push-dan sonra ozunu yenileyecek!';
        echo '=========================================';
        """
        self.run_background_task(ip, user, key_path, cmd)

    def reboot_server(self):
        ip, user, key_path = self.get_creds()
        if not messagebox.askyesno("Təsdiq", "Serveri yenidən başlatmaq (Reboot) istədiyinizə əminsiniz?"):
            return
            
        self.log(f"\n--- SERVER RESTART EDİLİR ({ip}) ---")
        cmd = "sudo reboot"
        # Reboot edəndə SSH bağlantısı dərhal qırıldığı üçün subprocess xəta verə bilər, ona görə də ignore edirik
        threading.Thread(target=lambda: self.run_ssh_command(ip, user, key_path, cmd), daemon=True).start()
        self.log("Serverə restart əmri verildi!")
        self.log("DİQQƏT: Server sönüb yenidən açıldığı üçün 1-2 dəqiqə əlaqə kəsiləcək. Zəhmət olmasa biraz gözləyin və sonra 'Qoşulmanı Yoxla' düyməsi ilə təkrar yoxlayın.")
        
    def install_portainer(self):
        ip, user, key_path = self.get_creds()
        self.log(f"\n--- PORTAINER QURULUMU BAŞLADI ({ip}) ---")
        cmd = """
        echo 'Portainer üçün 8000 və 9000 portları açılır...';
        sudo iptables -I INPUT -p tcp -m tcp --dport 8000 -j ACCEPT 2>/dev/null || true;
        sudo iptables -I INPUT -p tcp -m tcp --dport 9000 -j ACCEPT 2>/dev/null || true;
        sudo netfilter-persistent save 2>/dev/null || true;
        sudo ufw allow 8000/tcp 2>/dev/null || true;
        sudo ufw allow 9000/tcp 2>/dev/null || true;
        
        echo 'Köhnə Portainer varsa silinir...';
        sudo docker stop portainer 2>/dev/null || true;
        sudo docker rm portainer 2>/dev/null || true;
        
        echo 'Portainer üçün volume yaradılır...';
        sudo docker volume create portainer_data 2>/dev/null || true;
        
        echo 'Portainer yüklənir və işə salınır...';
        sudo docker run -d -p 8000:8000 -p 9000:9000 \
            --name portainer \
            --restart=always \
            -v /var/run/docker.sock:/var/run/docker.sock \
            -v portainer_data:/data \
            portainer/portainer-ce:latest;
            
        echo '=========================================';
        echo 'PORTAINER QURULDU! Link: http://'$(curl -s ifconfig.me)':9000';
        echo 'Zəhmət olmasa linkə girib yeni parol təyin edin.';
        echo '=========================================';
        """
        self.run_background_task(ip, user, key_path, cmd)

    def clean_server(self):
        ip, user, key_path = self.get_creds()
        msg = "DİQQƏT: Bu otağı tamamilə sıfırlayacaq!\n\n- Bütün layihələr və Docker konteynerləri silinəcək.\n- MasterDeploy paneli silinəcək.\n- Swap silinəcək.\n- DOCKER TAMAMİLƏ SİLİNƏCƏK.\n\nƏminsinizmi?"
        if not messagebox.askyesno("TƏHLÜKƏLİ ƏMƏLİYYAT", msg, icon='warning'):
            return
            
        self.log(f"\n--- SERVER TƏMİZLƏNİR ({ip}) ---")
        cmd = """
        echo '1. Docker konteynerləri dayandırılır və silinir...';
        sudo docker stop $(sudo docker ps -aq) 2>/dev/null || true;
        sudo docker rm $(sudo docker ps -aq) 2>/dev/null || true;
        
        echo '2. Layihə faylları silinir...';
        sudo rm -rf /data/masterdeploy;
        sudo rm -rf ~/server-repo-rust;
        
        echo '3. Docker tamamilə sistemdən silinir...';
        sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras 2>/dev/null || true;
        sudo rm -rf /var/lib/docker /etc/docker;
        
        echo '4. Swap silinir...';
        sudo swapoff /swapfile 2>/dev/null || true;
        sudo rm -f /swapfile;
        sudo sed -i '\\/swapfile/d' /etc/fstab 2>/dev/null || true;
        
        echo '=========================================';
        echo 'TƏMİZLƏNMƏ BİTDİ! Server ilk günkü kimidir.';
        echo '=========================================';
        """
        self.run_background_task(ip, user, key_path, cmd)

    def start_monitoring(self):
        if self.monitoring_active:
            return
        self.monitoring_active = True
        threading.Thread(target=self.monitor_loop, daemon=True).start()

    def monitor_loop(self):
        import time
        ip, user, key_path = self.get_creds()
        
        # CPU, RAM, və Swap-ı tək bir SSH komandası ilə yoxlayırıq
        cmd = "free -m | awk 'NR==2{print $2,$3}; NR==3{print $2,$3}'; cat /proc/loadavg | awk '{print $1}'"
        
        while self.monitoring_active:
            try:
                ssh_cmd = [
                    "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd
                ]
                
                # subprocess arxa planda işləyir (konsolsuz)
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                process = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=creationflags)
                out, _ = process.communicate()
                
                if process.returncode == 0:
                    lines = out.strip().split('\\n')
                    if len(lines) >= 3:
                        ram_total, ram_used = lines[0].split()
                        swap_total, swap_used = lines[1].split()
                        cpu_load = lines[2]
                        
                        ram_total_gb = float(ram_total) / 1024
                        ram_used_gb = float(ram_used) / 1024
                        swap_total_gb = float(swap_total) / 1024
                        swap_used_gb = float(swap_used) / 1024
                        
                        self.root.after(0, self.update_monitor, ram_used_gb, ram_total_gb, swap_used_gb, swap_total_gb, cpu_load)
            except Exception:
                pass
            
            time.sleep(5)

    def update_monitor(self, ram_u, ram_t, swap_u, swap_t, cpu):
        self.lbl_cpu.config(text=f"CPU Yükü: {cpu}")
        self.lbl_ram.config(text=f"Mövcud RAM: {ram_u:.2f}GB / {ram_t:.2f}GB")
        
        if swap_t > 0:
            self.lbl_swap.config(text=f"Virtual RAM: {swap_u:.2f}GB / {swap_t:.2f}GB")
        else:
            self.lbl_swap.config(text="Virtual RAM: Yoxdur")

if __name__ == "__main__":
    root = tk.Tk()
    app = RemoteInstallerGUI(root)
    root.mainloop()
