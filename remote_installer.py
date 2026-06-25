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
        self.root.title("MasterDeploy Quraşdırıcı 🚀 (Remote & Local)")
        self.root.geometry("850x780")
        self.root.configure(bg=BG_COLOR, padx=20, pady=10)
        
        # Fontlar
        self.font_title = ("Segoe UI", 16, "bold")
        self.font_label = ("Segoe UI", 10, "bold")
        self.font_entry = ("Segoe UI", 10)
        self.font_btn = ("Segoe UI", 9, "bold")
        self.font_console = ("Consolas", 9)

        # --- Başlıq ---
        tk.Label(root, text="MİNİ-COOLİFY İDARƏETMƏ MƏRKƏZİ", font=self.font_title, bg=BG_COLOR, fg=ACCENT_COLOR).pack(pady=(0, 10))
        
        # --- Notebook (Tabs) ---
        style = ttk.Style()
        style.theme_use('default')
        style.configure('TNotebook.Tab', font=self.font_label, padding=[10, 5])
        
        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill=tk.BOTH, expand=True)
        
        self.tab_remote = tk.Frame(self.notebook, bg=BG_COLOR)
        self.tab_local = tk.Frame(self.notebook, bg=BG_COLOR)
        
        self.notebook.add(self.tab_remote, text="🌐 Uzaq Server (SSH)")
        self.notebook.add(self.tab_local, text="💻 Yerli PC (Local)")
        
        # --- Uzaq Server Tab Quraşdırılması ---
        self.setup_remote_tab()
        
        # --- Yerli PC Tab Quraşdırılması ---
        self.setup_local_tab()
        
        self.load_config()

        # Monitorinq dəyişənləri
        self.monitoring_active = False

        if self.ip_entry.get() and self.key_entry.get():
            self.root.after(500, lambda: self.test_connection(auto=True))

    def create_button(self, parent, text, bg_color, command, **kwargs):
        fg_color = kwargs.pop("fg", "white")
        btn = tk.Button(parent, text=text, bg=bg_color, fg=fg_color, font=self.font_btn, 
                        relief=tk.FLAT, borderwidth=0, cursor="hand2", 
                        activebackground="#555", activeforeground="white", command=command, **kwargs)
        return btn

    # ==========================================
    # REMOTE TAB (UZAQ SERVER)
    # ==========================================
    def setup_remote_tab(self):
        form_frame = tk.Frame(self.tab_remote, bg=CARD_COLOR, bd=0, relief=tk.FLAT, highlightbackground="#333", highlightthickness=1)
        form_frame.pack(fill=tk.X, pady=10, ipady=10, ipadx=10)
        
        tk.Label(form_frame, text="Server IP:", font=self.font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=0, column=0, sticky=tk.W, pady=5, padx=10)
        self.ip_entry = tk.Entry(form_frame, width=35, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.ip_entry.grid(row=0, column=1, pady=5, padx=10, ipady=4)
        
        tk.Label(form_frame, text="İstifadəçi adı:", font=self.font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=1, column=0, sticky=tk.W, pady=5, padx=10)
        self.user_entry = tk.Entry(form_frame, width=35, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.user_entry.insert(0, "ubuntu")
        self.user_entry.grid(row=1, column=1, pady=5, padx=10, ipady=4)
        
        tk.Label(form_frame, text="SSH Açarı:", font=self.font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=2, column=0, sticky=tk.W, pady=5, padx=10)
        key_frame = tk.Frame(form_frame, bg=CARD_COLOR)
        key_frame.grid(row=2, column=1, sticky=tk.W, padx=10)
        self.key_entry = tk.Entry(key_frame, width=27, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.key_entry.pack(side=tk.LEFT, ipady=4)
        self.create_button(key_frame, "Seç", "#555", self.browse_key).pack(side=tk.LEFT, padx=10, ipady=2, ipadx=10)

        tk.Label(form_frame, text="Swap (GB):", font=self.font_label, bg=CARD_COLOR, fg=BTN_CHECK).grid(row=3, column=0, sticky=tk.W, pady=5, padx=10)
        self.swap_entry = tk.Entry(form_frame, width=15, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.swap_entry.grid(row=3, column=1, sticky=tk.W, pady=5, padx=10, ipady=4)

        tk.Label(form_frame, text="Panel Portu:", font=self.font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=4, column=0, sticky=tk.W, pady=5, padx=10)
        self.panel_port_entry = tk.Entry(form_frame, width=15, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.panel_port_entry.grid(row=4, column=1, sticky=tk.W, pady=5, padx=10, ipady=4)

        tk.Label(form_frame, text="Portainer Portu:", font=self.font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=5, column=0, sticky=tk.W, pady=5, padx=10)
        self.portainer_port_entry = tk.Entry(form_frame, width=15, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.portainer_port_entry.grid(row=5, column=1, sticky=tk.W, pady=5, padx=10, ipady=4)

        # Düymələr
        btn_frame = tk.Frame(self.tab_remote, bg=BG_COLOR)
        btn_frame.pack(fill=tk.X, pady=5)
        self.btn_check = self.create_button(btn_frame, "🔗 Yoxla", BTN_CHECK, self.test_connection)
        self.btn_check.grid(row=0, column=0, padx=3, ipady=4, ipadx=3)
        self.btn_prep = self.create_button(btn_frame, "🛠️ Hazırla", BTN_PREP, lambda: self.run_remote_task(self.get_cmd_prep))
        self.btn_prep.grid(row=0, column=1, padx=3, ipady=4, ipadx=3)
        self.btn_panel = self.create_button(btn_frame, "🚀 Paneli Qur", BTN_PANEL, lambda: self.run_remote_task(self.get_cmd_panel))
        self.btn_panel.grid(row=0, column=2, padx=3, ipady=4, ipadx=3)
        self.btn_all = self.create_button(btn_frame, "🌟 Tam Qur", BTN_ALL, lambda: self.run_remote_task(self.get_cmd_all))
        self.btn_all.grid(row=0, column=3, padx=3, ipady=4, ipadx=3)

        extra_btn_frame = tk.Frame(self.tab_remote, bg=BG_COLOR)
        extra_btn_frame.pack(fill=tk.X, pady=5)
        self.btn_reboot = self.create_button(extra_btn_frame, "🔄 Restart", BTN_REBOOT, self.remote_reboot, fg="black")
        self.btn_reboot.grid(row=0, column=0, padx=3, ipady=4, ipadx=5)
        self.btn_clean = self.create_button(extra_btn_frame, "🗑️ Təmizlə", BTN_CLEAN, lambda: self.run_remote_task(self.get_cmd_clean, confirm="Serveri tamamilə sıfırlamaq istəyirsiniz?"))
        self.btn_clean.grid(row=0, column=1, padx=3, ipady=4, ipadx=5)
        self.btn_portainer = self.create_button(extra_btn_frame, "🐳 Portainer", "#00A2D3", lambda: self.run_remote_task(self.get_cmd_portainer))
        self.btn_portainer.grid(row=0, column=2, padx=3, ipady=4, ipadx=5)
        self.btn_token = self.create_button(extra_btn_frame, "🔑 Token Yarat", "#8E44AD", lambda: self.trigger_portainer_token(is_local=False))
        self.btn_token.grid(row=0, column=3, padx=3, ipady=4, ipadx=5)

        self.remote_action_btns = [self.btn_prep, self.btn_panel, self.btn_all, self.btn_reboot, self.btn_clean, self.btn_portainer, self.btn_token]
        self.toggle_remote_buttons(tk.DISABLED)

        # Monitor
        self.monitor_frame = tk.Frame(self.tab_remote, bg="#111111", highlightbackground="#00FF00", highlightthickness=1)
        self.lbl_cpu = tk.Label(self.monitor_frame, text="CPU: --", bg="#111111", fg="#00FF00", font=("Consolas", 9, "bold"))
        self.lbl_cpu.pack(side=tk.LEFT, expand=True, pady=2)
        self.lbl_ram = tk.Label(self.monitor_frame, text="RAM: -- / --", bg="#111111", fg="#00FF00", font=("Consolas", 9, "bold"))
        self.lbl_ram.pack(side=tk.LEFT, expand=True, pady=2)
        self.lbl_swap = tk.Label(self.monitor_frame, text="SWAP: -- / --", bg="#111111", fg="#00FF00", font=("Consolas", 9, "bold"))
        self.lbl_swap.pack(side=tk.LEFT, expand=True, pady=2)

        # Konsol
        tk.Label(self.tab_remote, text="Uzaq Server Çıxışı:", font=self.font_label, bg=BG_COLOR, fg=ACCENT_COLOR).pack(anchor=tk.W, pady=(10, 0))
        self.console_remote = scrolledtext.ScrolledText(self.tab_remote, height=9, bg="#0A0A0A", fg="#00FF00", font=self.font_console, relief=tk.FLAT, padx=5, pady=5)
        self.console_remote.pack(fill=tk.BOTH, expand=True, pady=5)
        self.create_button(self.tab_remote, "📄 Kopyala", "#444", lambda: self.copy_console(self.console_remote)).pack(anchor=tk.E)

    # ==========================================
    # LOCAL TAB (YERLİ PC)
    # ==========================================
    def setup_local_tab(self):
        form_frame = tk.Frame(self.tab_local, bg=CARD_COLOR, bd=0, relief=tk.FLAT, highlightbackground="#333", highlightthickness=1)
        form_frame.pack(fill=tk.X, pady=10, ipady=10, ipadx=10)
        
        tk.Label(form_frame, text="Sudo (Admin) Parolu:", font=self.font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=0, column=0, sticky=tk.W, pady=5, padx=10)
        self.local_pass_entry = tk.Entry(form_frame, width=35, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT, show="*")
        self.local_pass_entry.grid(row=0, column=1, pady=5, padx=10, ipady=4)
        
        tk.Label(form_frame, text="Swap (GB):", font=self.font_label, bg=CARD_COLOR, fg=BTN_CHECK).grid(row=1, column=0, sticky=tk.W, pady=5, padx=10)
        self.local_swap_entry = tk.Entry(form_frame, width=15, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.local_swap_entry.insert(0, "2")
        self.local_swap_entry.grid(row=1, column=1, sticky=tk.W, pady=5, padx=10, ipady=4)

        tk.Label(form_frame, text="Panel Portu:", font=self.font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=2, column=0, sticky=tk.W, pady=5, padx=10)
        self.local_panel_port_entry = tk.Entry(form_frame, width=15, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.local_panel_port_entry.grid(row=2, column=1, sticky=tk.W, pady=5, padx=10, ipady=4)

        tk.Label(form_frame, text="Portainer Portu:", font=self.font_label, bg=CARD_COLOR, fg=TEXT_COLOR).grid(row=3, column=0, sticky=tk.W, pady=5, padx=10)
        self.local_portainer_port_entry = tk.Entry(form_frame, width=15, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.local_portainer_port_entry.grid(row=3, column=1, sticky=tk.W, pady=5, padx=10, ipady=4)

        # Düymələr
        btn_frame = tk.Frame(self.tab_local, bg=BG_COLOR)
        btn_frame.pack(fill=tk.X, pady=15)
        
        self.btn_local_check = self.create_button(btn_frame, "🔐 İcazəni Yoxla", BTN_CHECK, self.test_local_connection)
        self.btn_local_check.grid(row=0, column=0, padx=3, ipady=4, ipadx=3)
        self.btn_local_prep = self.create_button(btn_frame, "🛠️ Hazırla", BTN_PREP, lambda: self.run_local_task(self.get_cmd_prep))
        self.btn_local_prep.grid(row=0, column=1, padx=3, ipady=4, ipadx=3)
        self.btn_local_panel = self.create_button(btn_frame, "🚀 Paneli Qur", BTN_PANEL, lambda: self.run_local_task(self.get_cmd_panel))
        self.btn_local_panel.grid(row=0, column=2, padx=3, ipady=4, ipadx=3)
        self.btn_local_all = self.create_button(btn_frame, "🌟 Tam Qur", BTN_ALL, lambda: self.run_local_task(self.get_cmd_all))
        self.btn_local_all.grid(row=0, column=3, padx=3, ipady=4, ipadx=3)

        extra_btn_frame = tk.Frame(self.tab_local, bg=BG_COLOR)
        extra_btn_frame.pack(fill=tk.X, pady=5)
        self.btn_local_clean = self.create_button(extra_btn_frame, "🗑️ Təmizlə", BTN_CLEAN, lambda: self.run_local_task(self.get_cmd_clean, confirm="Bütün sistemi təmizləmək istədiyinizə əminsiniz?"))
        self.btn_local_clean.grid(row=0, column=0, padx=3, ipady=4, ipadx=5)
        self.btn_local_portainer = self.create_button(extra_btn_frame, "🐳 Portainer", "#00A2D3", lambda: self.run_local_task(self.get_cmd_portainer))
        self.btn_local_portainer.grid(row=0, column=1, padx=3, ipady=4, ipadx=5)
        self.btn_local_token = self.create_button(extra_btn_frame, "🔑 Token Yarat", "#8E44AD", lambda: self.trigger_portainer_token(is_local=True))
        self.btn_local_token.grid(row=0, column=2, padx=3, ipady=4, ipadx=5)

        self.local_action_btns = [self.btn_local_prep, self.btn_local_panel, self.btn_local_all, self.btn_local_clean, self.btn_local_portainer, self.btn_local_token]
        self.toggle_local_buttons(tk.DISABLED)

        # Konsol
        tk.Label(self.tab_local, text="Lokal PC Çıxışı:", font=self.font_label, bg=BG_COLOR, fg=ACCENT_COLOR).pack(anchor=tk.W, pady=(10, 0))
        self.console_local = scrolledtext.ScrolledText(self.tab_local, height=13, bg="#0A0A0A", fg="#00FF00", font=self.font_console, relief=tk.FLAT, padx=5, pady=5)
        self.console_local.pack(fill=tk.BOTH, expand=True, pady=5)
        self.create_button(self.tab_local, "📄 Kopyala", "#444", lambda: self.copy_console(self.console_local)).pack(anchor=tk.E)

    # ==========================================
    # LOGGING & CONFIG
    # ==========================================
    def log_remote(self, message):
        self.console_remote.insert(tk.END, message + "\n")
        self.console_remote.see(tk.END)
        self.root.update_idletasks()

    def log_local(self, message):
        self.console_local.insert(tk.END, message + "\n")
        self.console_local.see(tk.END)
        self.root.update_idletasks()

    def copy_console(self, console_widget):
        text = console_widget.get("1.0", tk.END)
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        messagebox.showinfo("Kopyalandı", "Çıxış yaddaşa kopyalandı!")

    def browse_key(self):
        filename = filedialog.askopenfilename(title="SSH Açarını Seç", filetypes=[("Key Files", "*.key *.pem"), ("All Files", "*.*")])
        if filename:
            self.key_entry.delete(0, tk.END)
            self.key_entry.insert(0, filename)

    def load_config(self):
        try:
            if os.path.exists("config.json"):
                with open("config.json", "r") as f:
                    data = json.load(f)
                    self.ip_entry.insert(0, data.get("ip", ""))
                    self.user_entry.delete(0, tk.END)
                    self.user_entry.insert(0, data.get("user", "ubuntu"))
                    self.key_entry.insert(0, data.get("key", ""))
                    
                    swap_val = data.get("swap", "2")
                    self.swap_entry.delete(0, tk.END)
                    self.swap_entry.insert(0, swap_val)
                    self.local_swap_entry.delete(0, tk.END)
                    self.local_swap_entry.insert(0, swap_val)
                    
                    panel_val = data.get("panel_port", "3000")
                    self.panel_port_entry.insert(0, panel_val)
                    self.local_panel_port_entry.insert(0, panel_val)
                    
                    port_val = data.get("portainer_port", "9000")
                    self.portainer_port_entry.insert(0, port_val)
                    self.local_portainer_port_entry.insert(0, port_val)
            else:
                self.user_entry.insert(0, "ubuntu")
                self.swap_entry.insert(0, "2")
                self.local_swap_entry.insert(0, "2")
                self.panel_port_entry.insert(0, "3000")
                self.local_panel_port_entry.insert(0, "3000")
                self.portainer_port_entry.insert(0, "9000")
                self.local_portainer_port_entry.insert(0, "9000")
        except: pass

    def save_config(self):
        try:
            # We sync entries from whichever tab was active
            active_tab = self.notebook.index(self.notebook.select())
            if active_tab == 0:
                swap_val = self.swap_entry.get().strip()
                panel_val = self.panel_port_entry.get().strip()
                portainer_val = self.portainer_port_entry.get().strip()
            else:
                swap_val = self.local_swap_entry.get().strip()
                panel_val = self.local_panel_port_entry.get().strip()
                portainer_val = self.local_portainer_port_entry.get().strip()
                
            data = {
                "ip": self.ip_entry.get().strip(),
                "user": self.user_entry.get().strip(),
                "key": self.key_entry.get().strip(),
                "swap": swap_val,
                "panel_port": panel_val,
                "portainer_port": portainer_val
            }
            with open("config.json", "w") as f:
                json.dump(data, f)
        except: pass

    # ==========================================
    # TOGGLE BUTTONS
    # ==========================================
    def toggle_remote_buttons(self, state):
        for btn in self.remote_action_btns:
            btn.config(state=state)
            if state == tk.DISABLED:
                btn.config(bg="#333333", fg="#888888")
            else:
                if btn == self.btn_prep: btn.config(bg=BTN_PREP, fg="white")
                elif btn == self.btn_panel: btn.config(bg=BTN_PANEL, fg="white")
                elif btn == self.btn_all: btn.config(bg=BTN_ALL, fg="white")
                elif btn == self.btn_reboot: btn.config(bg=BTN_REBOOT, fg="black")
                elif btn == self.btn_clean: btn.config(bg=BTN_CLEAN, fg="white")
                elif btn == self.btn_portainer: btn.config(bg="#00A2D3", fg="white")
                elif btn == getattr(self, 'btn_token', None): btn.config(bg="#8E44AD", fg="white")

    def toggle_local_buttons(self, state):
        for btn in self.local_action_btns:
            btn.config(state=state)
            if state == tk.DISABLED:
                btn.config(bg="#333333", fg="#888888")
            else:
                if btn == self.btn_local_prep: btn.config(bg=BTN_PREP, fg="white")
                elif btn == self.btn_local_panel: btn.config(bg=BTN_PANEL, fg="white")
                elif btn == self.btn_local_all: btn.config(bg=BTN_ALL, fg="white")
                elif btn == self.btn_local_clean: btn.config(bg=BTN_CLEAN, fg="white")
                elif btn == self.btn_local_portainer: btn.config(bg="#00A2D3", fg="white")
                elif btn == getattr(self, 'btn_local_token', None): btn.config(bg="#8E44AD", fg="white")

    # ==========================================
    # API & TOKEN GENERATION
    # ==========================================
    def trigger_portainer_token(self, is_local):
        if is_local:
            ip = "127.0.0.1"
            port = self.local_portainer_port_entry.get().strip() or "9000"
        else:
            ip = self.ip_entry.get().strip()
            port = self.portainer_port_entry.get().strip() or "9000"
            if not ip:
                messagebox.showwarning("Xəta", "Uzaq serverin IP ünvanını daxil edin!")
                return
                
        threading.Thread(target=self.generate_portainer_token, args=(ip, port, is_local), daemon=True).start()

    def generate_portainer_token(self, ip, port, is_local):
        import urllib.request
        import urllib.error
        import time

        logger = self.log_local if is_local else self.log_remote
        logger(f"\n--- Portainer Token Yaradılması ({ip}:{port}) ---")
        base_url = f"http://{ip}:{port}"
        
        # Helper to make requests
        def make_req(endpoint, payload=None, method="POST", headers=None):
            url = f"{base_url}{endpoint}"
            req_headers = {"Content-Type": "application/json"}
            if headers: req_headers.update(headers)
            
            data = None
            if payload: data = json.dumps(payload).encode('utf-8')
            
            req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    return response.status, json.loads(response.read().decode())
            except urllib.error.HTTPError as e:
                try:
                    err_text = e.read().decode()
                    return e.code, json.loads(err_text)
                except:
                    return e.code, {"raw_error": err_text}
            except Exception as e:
                return 0, {"err": str(e)}

        # Wait for Portainer to be up (give it 3 seconds)
        logger("1. Portainer-in tam aktivləşməsi gözlənilir (3 saniyə)...")
        time.sleep(3)
        
        # Step 0: Extract Setup Token from Docker logs
        setup_token = ""
        logger("-> Setup Token axtarılır...")
        try:
            if is_local:
                sudo_pass = self.local_pass_entry.get().strip()
                cmd = ["sudo", "-S", "docker", "logs", "portainer"]
                proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, universal_newlines=True)
                out, _ = proc.communicate(input=sudo_pass + "\n", timeout=10)
                for line in out.split('\n'):
                    if "setup_token=" in line:
                        setup_token = line.split("setup_token=")[1].strip()
                        break
            else:
                user = self.user_entry.get().strip()
                key_path = self.key_entry.get().strip()
                ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-i", key_path, f"{user}@{ip}", "sudo docker logs portainer"]
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=10, creationflags=creationflags)
                for line in proc.stdout.split('\n'):
                    if "setup_token=" in line:
                        setup_token = line.split("setup_token=")[1].strip()
                        break
        except Exception as e:
            logger(f"⚠️ Docker loglarını oxuyarkən xəta: {e}")

        if setup_token:
            logger(f"[INFO] Setup Token tapıldı!")
        else:
            logger(f"[INFO] Setup Token tapılmadı (Köhnə versiya və ya artıq aktivdir).")

        # Step 1: Init Admin
        logger("2. Admin hesabının inisializasiyası yoxlanılır...")
        headers = {"X-Setup-Token": setup_token} if setup_token else {}
        status, res = make_req("/api/users/admin/init", {"Username": "admin", "Password": "nesibbey1212"}, headers=headers)
        if status == 0:
            logger(f"❌ Portainer serverinə qoşulmaq mümkün olmadı: {res.get('err')}")
            return
            
        if status == 409:
            logger("[INFO] Admin hesabı artıq aktivdir.")
        elif status == 200 or status == 204:
            logger("[INFO] Admin hesabı yeni 'nesibbey1212' parolu ilə aktivləşdirildi.")
        else:
            logger(f"⚠️ Init Xətası ({status}): {res}")

        # Step 2: Auth
        logger("3. JWT Sessiyası alınır...")
        status, res = make_req("/api/auth", {"Username": "admin", "Password": "nesibbey1212"})
        if status != 200:
            logger(f"❌ Autentifikasiya Xətası ({status}). Ola bilsin admin parolu artıq dəyişdirilib.")
            self.root.after(0, lambda: messagebox.showerror("Xəta", "Portainer-ə daxil olmaq olmadı. Əgər parolu brauzerdə dəyişmisinizsə, tokeni əllə almalısınız."))
            return
            
        jwt_token = res.get("jwt")
        
        # Step 3: Create Access Token
        logger("4. Access Token (API) yaradılır...")
        # Get users to find admin id (usually 1)
        status, res = make_req("/api/users", method="GET", headers={"Authorization": f"Bearer {jwt_token}"})
        admin_id = 1
        if status == 200:
            for u in res:
                if u.get("Username") == "admin":
                    admin_id = u.get("Id")
                    break
                    
        # Generate token
        status, res = make_req(f"/api/users/{admin_id}/tokens", {"description": "masterdeploy_api"}, headers={"Authorization": f"Bearer {jwt_token}"})
        if status != 200 and status != 201:
            logger(f"❌ Token yaratma xətası ({status}): {res}")
            return
            
        api_token = res.get("prefix", "") + res.get("token", "")
        if not api_token: api_token = res.get("token", "")
        
        logger(f"\n✅ TOKEN UĞURLA YARADILDI!")
        
        self.root.after(0, lambda: self.show_token_window(api_token))

    def show_token_window(self, token):
        win = tk.Toplevel(self.root)
        win.title("🔑 MasterDeploy Tokeni")
        win.geometry("500x200")
        win.configure(bg=CARD_COLOR)
        
        tk.Label(win, text="Portainer API Tokeniniz:", font=self.font_title, bg=CARD_COLOR, fg=ACCENT_COLOR).pack(pady=10)
        tk.Label(win, text="Bu tokeni MasterDeploy panelində 'Portainer Token' xanasına yapışdırın.", font=self.font_label, bg=CARD_COLOR, fg=TEXT_COLOR).pack(pady=5)
        
        token_entry = tk.Entry(win, width=50, font=("Consolas", 10), bg=ENTRY_BG, fg="#00FF00", insertbackground="white", relief=tk.FLAT)
        token_entry.pack(pady=5, ipady=5)
        token_entry.insert(0, token)
        token_entry.config(state="readonly")
        
        def copy_btn():
            self.root.clipboard_clear()
            self.root.clipboard_append(token)
            messagebox.showinfo("Kopyalandı", "Token yaddaşa (clipboard) kopyalandı!", parent=win)
            win.destroy()
            
        self.create_button(win, "📄 Kopyala və Bağla", BTN_ALL, copy_btn).pack(pady=10, ipady=4, ipadx=10)

    # ==========================================
    # COMMAND GENERATORS
    # ==========================================
    def get_cmd_prep(self, swap_gb, panel_p, port_p):
        swap_mb = int(swap_gb) * 1024
        return f"""
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

    def get_cmd_panel(self, swap_gb, panel_p, port_p):
        return f"""
echo 'MasterDeploy Qurulur...';
sudo rm -rf server-repo-rust;
git clone https://github.com/kral14/server-repo-rust.git;
cd server-repo-rust/MasterDeploy-rust;

echo 'Portlar açılır ({panel_p})...';
sudo iptables -I INPUT -p tcp -m tcp --dport {panel_p} -j ACCEPT 2>/dev/null || true;
sudo netfilter-persistent save 2>/dev/null || true;
sudo ufw allow {panel_p}/tcp 2>/dev/null || true;

echo 'Köhnə panel silinir (əgər varsa)...';
sudo docker stop masterdeploy 2>/dev/null || true;
sudo docker rm masterdeploy 2>/dev/null || true;

echo 'Yeni panel yüklənir və işə salınır (GitHub-dan)...';
if ! sudo docker pull ghcr.io/kral14/server-repo-rust:latest; then
    echo '❌ XƏTA: GitHub-dan hazır Docker imicini yükləmək mümkün olmadı!';
    exit 1;
fi;

sudo docker run -d --name masterdeploy -p {panel_p}:3000 \
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
echo 'PANEL QURULDU! Link: http://'$(curl -s ifconfig.me)':{panel_p}';
echo 'Watchtower aktiv edildi!';
echo '=========================================';
"""

    def get_cmd_all(self, swap_gb, panel_p, port_p):
        swap_mb = int(swap_gb) * 1024
        return f"""
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
sudo iptables -I INPUT -p tcp -m tcp --dport {panel_p} -j ACCEPT 2>/dev/null || true;
sudo ufw allow {panel_p}/tcp 2>/dev/null || true;
sudo docker stop masterdeploy 2>/dev/null || true;
sudo docker rm masterdeploy 2>/dev/null || true;
sudo docker build -t masterdeploy-app . && \
sudo docker run -d --name masterdeploy -p {panel_p}:3000 -v /var/run/docker.sock:/var/run/docker.sock -v /data/masterdeploy:/data/masterdeploy -v ~/.ssh:/root/.ssh --restart unless-stopped masterdeploy-app;

echo 'Watchtower qurulur...';
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
echo 'PANEL QURULDU! Link: http://'$(curl -s ifconfig.me)':{panel_p}';
echo '=========================================';
"""

    def get_cmd_clean(self, swap_gb, panel_p, port_p):
        return """
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
echo 'TƏMİZLƏNMƏ BİTDİ! Sistem ilk günkü kimidir.';
echo '=========================================';
"""

    def get_cmd_portainer(self, swap_gb, panel_p, port_p):
        try:
            agent_p = str(int(port_p) - 1000)
        except:
            agent_p = "8000"
            
        return f"""
echo 'Portainer üçün {agent_p} və {port_p} portları açılır...';
sudo iptables -I INPUT -p tcp -m tcp --dport {agent_p} -j ACCEPT 2>/dev/null || true;
sudo iptables -I INPUT -p tcp -m tcp --dport {port_p} -j ACCEPT 2>/dev/null || true;
sudo netfilter-persistent save 2>/dev/null || true;
sudo ufw allow {agent_p}/tcp 2>/dev/null || true;
sudo ufw allow {port_p}/tcp 2>/dev/null || true;

sudo docker stop portainer 2>/dev/null || true;
sudo docker rm portainer 2>/dev/null || true;
sudo docker volume create portainer_data 2>/dev/null || true;

sudo docker run -d -p {agent_p}:8000 -p {port_p}:9000 \
    --name portainer \
    --restart=always \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v portainer_data:/data \
    portainer/portainer-ce:latest --no-setup-token;
    
echo '=========================================';
echo 'PORTAINER QURULDU! Link: http://'$(curl -s ifconfig.me)':{port_p}';
echo '=========================================';
"""

    # ==========================================
    # REMOTE EXECUTION
    # ==========================================
    def fix_key_permissions(self, key_path):
        if os.name == 'nt':
            try:
                domain = os.environ.get("USERDOMAIN", "")
                username = os.environ.get("USERNAME", "")
                if not username:
                    import getpass
                    username = getpass.getuser()
                identity = f"{domain}\\{username}" if domain else username
                subprocess.run(["icacls", key_path, "/inheritance:r"], capture_output=True)
                subprocess.run(["icacls", key_path, "/grant:r", f"{identity}:F"], capture_output=True)
            except: pass

    def test_connection(self, auto=False):
        ip = self.ip_entry.get().strip()
        user = self.user_entry.get().strip()
        key_path = self.key_entry.get().strip()
        
        if not ip or not user or not key_path:
            if not auto: messagebox.showwarning("Xəta", "Bütün xanaları doldurun!")
            return

        self.save_config()
        self.log_remote(f"\n--- Yoxlanılır: {user}@{ip} ---")
        self.btn_check.config(state=tk.DISABLED, text="Gözləyin...")
        
        def task():
            self.fix_key_permissions(key_path)
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", "echo 'Bağlantı Uğurludur!'"]
            try:
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, creationflags=creationflags)
                if proc.returncode == 0:
                    self.log_remote("✅ QOŞULMA UĞURLUDUR!")
                    self.root.after(0, lambda: self.toggle_remote_buttons(tk.NORMAL))
                    if not auto: messagebox.showinfo("Uğurlu", "Serverə qoşulma uğurludur!")
                    self.monitor_frame.pack(fill=tk.X, pady=(0, 10))
                    self.start_monitoring()
                else:
                    self.log_remote(f"❌ XƏTA:\n{proc.stdout}")
            except Exception as e:
                self.log_remote(f"❌ SİSTEM XƏTASI: {e}")
            self.root.after(0, lambda: self.btn_check.config(state=tk.NORMAL, text="🔗 Yoxla", bg=BTN_CHECK))

        threading.Thread(target=task, daemon=True).start()

    def run_remote_task(self, cmd_func, confirm=None):
        if confirm and not messagebox.askyesno("Təsdiq", confirm):
            return
            
        ip = self.ip_entry.get().strip()
        user = self.user_entry.get().strip()
        key_path = self.key_entry.get().strip()
        swap_gb = self.swap_entry.get().strip()
        if not swap_gb.isdigit(): swap_gb = "2"
        panel_port = self.panel_port_entry.get().strip() or "3000"
        portainer_port = self.portainer_port_entry.get().strip() or "9000"
        
        cmd = cmd_func(swap_gb, panel_port, portainer_port)
        self.save_config()
        self.toggle_remote_buttons(tk.DISABLED)
        
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
        
        def worker():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", "-i", key_path, f"{user}@{ip}", full_script]
            try:
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=creationflags)
                self.log_remote("[BİLGİ] Uzaq serverdə tapşırıq başladı. Loglar çəkilir...")
                self.tail_remote_logs(ip, user, key_path)
            except Exception as e:
                self.log_remote(f"Xəta: {e}")
                self.root.after(0, lambda: self.toggle_remote_buttons(tk.NORMAL))

        threading.Thread(target=worker, daemon=True).start()

    def tail_remote_logs(self, ip, user, key_path):
        ssh_cmd = [
            "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ServerAliveInterval=5", "-i", key_path, f"{user}@{ip}",
            "stdbuf -o0 tail -n +1 -F /tmp/mini_masterdeploy.log 2>/dev/null"
        ]
        try:
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            process = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0, creationflags=creationflags)
            buffer = bytearray()
            while True:
                char = process.stdout.read(1)
                if not char: break
                if char == b'\r' or char == b'\n':
                    if buffer:
                        line_str = buffer.decode('utf-8', errors='replace')
                        if line_str == "===TASK_COMPLETED_SUCCESS===":
                            self.root.after(0, self.log_remote, "✅ ƏMƏLİYYAT UĞURLA BİTDİ!")
                            self.root.after(0, lambda: self.toggle_remote_buttons(tk.NORMAL))
                            process.terminate()
                            break
                        elif line_str == "===TASK_FAILED===":
                            self.root.after(0, self.log_remote, "❌ ƏMƏLİYYAT ZAMANI XƏTA BAŞ VERDİ!")
                            self.root.after(0, lambda: self.toggle_remote_buttons(tk.NORMAL))
                            process.terminate()
                            break
                        else:
                            self.root.after(0, self.log_remote, line_str)
                        buffer.clear()
                else:
                    buffer.extend(char)
            process.wait()
        except:
            self.root.after(0, lambda: self.toggle_remote_buttons(tk.NORMAL))

    def remote_reboot(self):
        if not messagebox.askyesno("Təsdiq", "Serveri yenidən başlatmaq istədiyinizə əminsiniz?"): return
        ip = self.ip_entry.get().strip()
        user = self.user_entry.get().strip()
        key_path = self.key_entry.get().strip()
        self.log_remote(f"\n--- SERVER RESTART EDİLİR ({ip}) ---")
        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", "sudo reboot"]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=creationflags)
        threading.Thread(target=task, daemon=True).start()
        self.log_remote("Serverə restart əmri verildi! 1-2 dəqiqə əlaqə kəsiləcək.")

    # ==========================================
    # LOCAL EXECUTION
    # ==========================================
    def test_local_connection(self):
        if os.name == 'nt':
            messagebox.showerror("Xəta", "Bu rejim yalnız Linux (Ubuntu/Debian) əməliyyat sistemi üçündür!\nWindows-da quraşdırma aparıla bilməz.")
            self.log_local("❌ Yerli Quraşdırma yalnız Linux üçündür!")
            return
            
        sudo_pass = self.local_pass_entry.get().strip()
        if not sudo_pass:
            messagebox.showwarning("Xəta", "Sudo (Administrator) parolunu daxil edin!")
            return

        self.log_local("\n--- Yerli Sudo İcazəsi Yoxlanılır ---")
        self.btn_local_check.config(state=tk.DISABLED, text="Gözləyin...")
        
        def task():
            cmd = ["sudo", "-S", "echo", "Sudo isleyen veziyyetdedir"]
            try:
                proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                out, err = proc.communicate(input=sudo_pass + "\n")
                if proc.returncode == 0:
                    self.log_local("✅ SUDO İCAZƏSİ TƏSDİQLƏNDİ!")
                    self.root.after(0, lambda: self.toggle_local_buttons(tk.NORMAL))
                    if "Uğurlu" not in str(messagebox):
                        self.root.after(0, lambda: messagebox.showinfo("Uğurlu", "Administrator icazəsi qəbul edildi!"))
                else:
                    self.log_local(f"❌ XƏTA (Böyük ehtimal parol səhvdir):\n{err}")
            except Exception as e:
                self.log_local(f"❌ SİSTEM XƏTASI: {e}")
            self.root.after(0, lambda: self.btn_local_check.config(state=tk.NORMAL, text="🔐 İcazəni Yoxla", bg=BTN_CHECK))

        threading.Thread(target=task, daemon=True).start()

    def run_local_task(self, cmd_func, confirm=None):
        if os.name == 'nt':
            messagebox.showerror("Xəta", "Yerli quraşdırma yalnız Linux-da işləyir!")
            return
            
        if confirm and not messagebox.askyesno("Təsdiq", confirm):
            return
            
        sudo_pass = self.local_pass_entry.get().strip()
        swap_gb = self.local_swap_entry.get().strip()
        if not swap_gb.isdigit(): swap_gb = "2"
        panel_port = self.local_panel_port_entry.get().strip() or "3000"
        portainer_port = self.local_portainer_port_entry.get().strip() or "9000"
        
        cmd = cmd_func(swap_gb, panel_port, portainer_port)
        self.save_config()
        self.toggle_local_buttons(tk.DISABLED)
        self.log_local(f"\n--- YERLİ QURAŞDIRMA BAŞLADI ---")
        
        script_path = os.path.join(os.getcwd(), "local_temp_task.sh")
        full_script = f"""#!/bin/bash
{{
{cmd}
}} && echo '===TASK_COMPLETED_SUCCESS===' || echo '===TASK_FAILED==='
"""
        try:
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(full_script)
        except Exception as e:
            self.log_local(f"❌ Fayl yaradıla bilmədi: {e}")
            self.toggle_local_buttons(tk.NORMAL)
            return

        def worker():
            try:
                process = subprocess.Popen(
                    ["sudo", "-S", "bash", script_path],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    universal_newlines=True
                )
                process.stdin.write(sudo_pass + "\n")
                process.stdin.flush()
                
                for line in iter(process.stdout.readline, ''):
                    if not line: break
                    line_str = line.strip()
                    if line_str == "===TASK_COMPLETED_SUCCESS===":
                        self.root.after(0, self.log_local, "✅ ƏMƏLİYYAT UĞURLA BİTDİ!")
                        self.root.after(0, lambda: self.toggle_local_buttons(tk.NORMAL))
                        break
                    elif line_str == "===TASK_FAILED===":
                        self.root.after(0, self.log_local, "❌ ƏMƏLİYYAT ZAMANI XƏTA BAŞ VERDİ!")
                        self.root.after(0, lambda: self.toggle_local_buttons(tk.NORMAL))
                        break
                    else:
                        if "[sudo] password for" not in line_str:
                            self.root.after(0, self.log_local, line_str)
                process.wait()
            except Exception as e:
                self.root.after(0, self.log_local, f"Xəta: {e}")
                self.root.after(0, lambda: self.toggle_local_buttons(tk.NORMAL))
            finally:
                if os.path.exists(script_path):
                    os.remove(script_path)

        threading.Thread(target=worker, daemon=True).start()

    # ==========================================
    # MONITORING
    # ==========================================
    def start_monitoring(self):
        if self.monitoring_active: return
        self.monitoring_active = True
        threading.Thread(target=self.monitor_loop, daemon=True).start()

    def monitor_loop(self):
        import time
        ip, user, key_path = self.ip_entry.get().strip(), self.user_entry.get().strip(), self.key_entry.get().strip()
        cmd = "free -m | awk 'NR==2{print $2,$3}; NR==3{print $2,$3}'; cat /proc/loadavg | awk '{print $1}'"
        while self.monitoring_active:
            try:
                ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                process = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=creationflags)
                out, _ = process.communicate()
                if process.returncode == 0:
                    lines = out.strip().split('\\n')
                    if len(lines) >= 3:
                        r_tot, r_used = float(lines[0].split()[0])/1024, float(lines[0].split()[1])/1024
                        s_tot, s_used = float(lines[1].split()[0])/1024, float(lines[1].split()[1])/1024
                        cpu = lines[2]
                        self.root.after(0, self.update_monitor, r_used, r_tot, s_used, s_tot, cpu)
            except: pass
            time.sleep(5)

    def update_monitor(self, ram_u, ram_t, swap_u, swap_t, cpu):
        self.lbl_cpu.config(text=f"CPU: {cpu}")
        self.lbl_ram.config(text=f"RAM: {ram_u:.2f}GB / {ram_t:.2f}GB")
        if swap_t > 0: self.lbl_swap.config(text=f"SWAP: {swap_u:.2f}GB / {swap_t:.2f}GB")
        else: self.lbl_swap.config(text="SWAP: Yoxdur")

if __name__ == "__main__":
    root = tk.Tk()
    app = RemoteInstallerGUI(root)
    root.mainloop()
