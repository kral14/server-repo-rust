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
        self.root.configure(bg=BG_COLOR, padx=20, pady=10)
        
        # Docker Komponent Seçimləri (Default hamısı aktivdir)
        self.docker_engine_var = tk.BooleanVar(value=True)
        self.docker_cli_var = tk.BooleanVar(value=True)
        self.docker_buildx_var = tk.BooleanVar(value=True)
        self.docker_compose_var = tk.BooleanVar(value=True)
        self.docker_containerd_var = tk.BooleanVar(value=True)
        
        # Fontlar
        self.font_title = ("Segoe UI", 16, "bold")
        self.font_label = ("Segoe UI", 10, "bold")
        self.font_entry = ("Segoe UI", 10)
        self.font_btn = ("Segoe UI", 9, "bold")
        self.font_console = ("Consolas", 9)

        # Config yüklənir (pəncərə ölçüsü daxil olmaqla)
        self.load_config()

        # Ölçü dəyişəndə avtomatik save_config çağırmaq üçün event bağlayırıq
        self.root.bind("<Configure>", lambda e: self.save_window_geometry())

        # Monitorinq dəyişənləri
        self.monitoring_active = False

        # --- Notebook (Tabs) ---
        style = ttk.Style()
        style.theme_use('default')
        style.configure('TNotebook', background=BG_COLOR, borderwidth=0)
        style.configure('TNotebook.Tab', font=self.font_label, padding=[12, 6], background=CARD_COLOR, foreground=TEXT_COLOR)
        style.map('TNotebook.Tab', background=[('selected', ACCENT_COLOR)], foreground=[('selected', 'black')])
        
        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill=tk.BOTH, expand=True, pady=(5, 5))
        
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
    # ==========================================
    # REMOTE TAB (UZAQ SERVER)
    # ==========================================
    # ==========================================
    # REMOTE TAB (UZAQ SERVER)
    # ==========================================
    def setup_remote_tab(self):
        # 1. Giriş Məlumatları və Konfiqurasiya YANA-YANA (Horizontal Split)
        top_split_frame = tk.Frame(self.tab_remote, bg=BG_COLOR)
        top_split_frame.pack(fill=tk.X, pady=5)
        
        # Sol tərəf: Giriş məlumatları
        cred_lf = tk.LabelFrame(top_split_frame, text=" 🔐 Server Giriş Məlumatları ", font=(self.font_label[0], 9, "bold"), bg=BG_COLOR, fg=ACCENT_COLOR, bd=1, relief=tk.GROOVE)
        cred_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 5), ipady=5)
        
        tk.Label(cred_lf, text="Server IP:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=0, column=0, sticky=tk.W, pady=4, padx=8)
        self.ip_entry = tk.Entry(cred_lf, width=22, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.ip_entry.grid(row=0, column=1, pady=4, padx=8, ipady=3)
        
        tk.Label(cred_lf, text="İstifadəçi:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=1, column=0, sticky=tk.W, pady=4, padx=8)
        self.user_entry = tk.Entry(cred_lf, width=22, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.user_entry.insert(0, "ubuntu")
        self.user_entry.grid(row=1, column=1, pady=4, padx=8, ipady=3)
        
        tk.Label(cred_lf, text="SSH Açarı:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=2, column=0, sticky=tk.W, pady=4, padx=8)
        key_frame = tk.Frame(cred_lf, bg=BG_COLOR)
        key_frame.grid(row=2, column=1, sticky=tk.W, padx=8)
        self.key_entry = tk.Entry(key_frame, width=15, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.key_entry.pack(side=tk.LEFT, ipady=3)
        self.create_button(key_frame, "Seç", "#555", self.browse_key).pack(side=tk.LEFT, padx=3, ipady=1, ipadx=5)

        # Sağ tərəf: Konfiqurasiyalar
        config_lf = tk.LabelFrame(top_split_frame, text=" ⚙️ Konfiqurasiya ", font=(self.font_label[0], 9, "bold"), bg=BG_COLOR, fg="#FFCC00", bd=1, relief=tk.GROOVE)
        config_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(5, 0), ipady=5)

        tk.Label(config_lf, text="Swap (GB):", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=0, column=0, sticky=tk.W, pady=4, padx=8)
        self.swap_entry = tk.Entry(config_lf, width=12, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.swap_entry.grid(row=0, column=1, sticky=tk.W, pady=4, padx=8, ipady=3)

        tk.Label(config_lf, text="Panel Portu:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=1, column=0, sticky=tk.W, pady=4, padx=8)
        self.panel_port_entry = tk.Entry(config_lf, width=12, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.panel_port_entry.grid(row=1, column=1, sticky=tk.W, pady=4, padx=8, ipady=3)

        tk.Label(config_lf, text="Portainer Port:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=2, column=0, sticky=tk.W, pady=4, padx=8)
        self.portainer_port_entry = tk.Entry(config_lf, width=12, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.portainer_port_entry.grid(row=2, column=1, sticky=tk.W, pady=4, padx=8, ipady=3)

        # 2. Port İdarəetmə Paneli (Yeni Hissə)
        port_mgmt_lf = tk.LabelFrame(self.tab_remote, text=" 🔌 Firewall Port İdarəetməsi (UFW / Iptables) ", font=(self.font_label[0], 9, "bold"), bg=BG_COLOR, fg="#E74C3C", bd=1, relief=tk.GROOVE)
        port_mgmt_lf.pack(fill=tk.X, pady=5, ipady=5, ipadx=5)

        tk.Label(port_mgmt_lf, text="Port:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).pack(side=tk.LEFT, padx=(10, 5))
        self.target_port_entry = tk.Entry(port_mgmt_lf, width=8, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.target_port_entry.pack(side=tk.LEFT, padx=5, ipady=3)

        self.btn_port_open = self.create_button(port_mgmt_lf, "🔓 Portu Aç", "#27AE60", self.remote_open_port)
        self.btn_port_open.pack(side=tk.LEFT, padx=5, ipady=3, ipadx=10)

        self.btn_port_close = self.create_button(port_mgmt_lf, "🔒 Portu Bağla", "#C0392B", self.remote_close_port)
        self.btn_port_close.pack(side=tk.LEFT, padx=5, ipady=3, ipadx=10)

        self.btn_port_list = self.create_button(port_mgmt_lf, "📋 Portları Listələ", "#2980B9", self.remote_list_ports)
        self.btn_port_list.pack(side=tk.LEFT, padx=10, ipady=3, ipadx=10)

        # Monitor (Düymələrin üstünə)
        self.monitor_frame = tk.Frame(self.tab_remote, bg="#1a1a1a", highlightbackground=ACCENT_COLOR, highlightthickness=1)
        self.monitor_frame.pack(fill=tk.X, pady=(5, 10))
        
        self.lbl_cpu = tk.Label(self.monitor_frame, text="🟢 CPU: --", bg="#1a1a1a", fg=ACCENT_COLOR, font=("Consolas", 10, "bold"))
        self.lbl_cpu.pack(side=tk.LEFT, expand=True, pady=6)
        self.lbl_ram = tk.Label(self.monitor_frame, text="💾 RAM: -- / --", bg="#1a1a1a", fg="#00FF00", font=("Consolas", 10, "bold"))
        self.lbl_ram.pack(side=tk.LEFT, expand=True, pady=6)
        self.lbl_swap = tk.Label(self.monitor_frame, text="🔄 SWAP: -- / --", bg="#1a1a1a", fg="#FFCC00", font=("Consolas", 10, "bold"))
        self.lbl_swap.pack(side=tk.LEFT, expand=True, pady=6)

        # 3. Düymələr Qrupu - YANA-YANA (Horizontal Flow Layout)
        btn_action_frame = tk.Frame(self.tab_remote, bg=BG_COLOR)
        btn_action_frame.pack(fill=tk.X, pady=5)
        
        # Quraşdırma & İdarəetmə Düymələri
        setup_lf = tk.LabelFrame(btn_action_frame, text=" 🛠️ Quraşdırma ", font=(self.font_label[0], 8, "bold"), bg=BG_COLOR, fg="#00FF00", bd=1, relief=tk.GROOVE)
        setup_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=2)
        
        self.btn_check = self.create_button(setup_lf, "🔗 Yoxla", BTN_CHECK, self.test_connection)
        self.btn_check.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        self.btn_swap = self.create_button(setup_lf, "🔄 Swap Qur", "#E67E22", lambda: self.run_remote_task(self.get_cmd_swap))
        self.btn_swap.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        self.btn_git = self.create_button(setup_lf, "🐙 Git Qur", "#9B59B6", lambda: self.run_remote_task(self.get_cmd_git))
        self.btn_git.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        # Docker üçün xüsusi yan-yana panel (Düymə + ⚙️)
        docker_btn_frame = tk.Frame(setup_lf, bg=BG_COLOR)
        docker_btn_frame.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5)
        
        self.btn_docker = self.create_button(docker_btn_frame, "🐳 Docker Qur", BTN_PREP, lambda: self.run_remote_task(self.get_cmd_docker))
        self.btn_docker.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=4)
        
        self.btn_docker_settings = self.create_button(docker_btn_frame, "⚙️", "#444", self.open_docker_settings)
        self.btn_docker_settings.pack(side=tk.LEFT, padx=(2, 0), ipady=4, ipadx=4)
        
        self.btn_panel = self.create_button(setup_lf, "🚀 Paneli Qur", BTN_PANEL, lambda: self.run_remote_task(self.get_cmd_panel))
        self.btn_panel.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        self.btn_all = self.create_button(setup_lf, "🌟 Tam Qur", BTN_ALL, lambda: self.run_remote_task(self.get_cmd_all))
        self.btn_all.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)

        # Sistem & Xidmətlər Düymələri
        sys_lf = tk.LabelFrame(btn_action_frame, text=" 🖥️ Server & Servislər ", font=(self.font_label[0], 8, "bold"), bg=BG_COLOR, fg="#FFCC00", bd=1, relief=tk.GROOVE)
        sys_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=2)

        self.btn_reboot = self.create_button(sys_lf, "🔄 Restart", BTN_REBOOT, self.remote_reboot, fg="black")
        self.btn_reboot.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_clean = self.create_button(sys_lf, "🗑️ Təmizlə", BTN_CLEAN, lambda: self.run_remote_task(self.get_cmd_clean, confirm="Serveri tamamilə sıfırlamaq istəyirsiniz?"))
        self.btn_clean.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_portainer = self.create_button(sys_lf, "🐳 Portainer", "#00A2D3", lambda: self.run_remote_task(self.get_cmd_portainer))
        self.btn_portainer.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_token = self.create_button(sys_lf, "🔑 Token Yarat", "#8E44AD", lambda: self.trigger_portainer_token(is_local=False))
        self.btn_token.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)

        self.remote_action_btns = [self.btn_swap, self.btn_git, self.btn_docker, self.btn_docker_settings, self.btn_panel, self.btn_all, self.btn_reboot, self.btn_clean, self.btn_portainer, self.btn_token, self.btn_port_open, self.btn_port_close, self.btn_port_list]
        self.toggle_remote_buttons(tk.DISABLED)

        # Konsol İdarəetmə Alətləri (Zoom In, Zoom Out, Təmizlə, Kopyala, Yenilə)
        console_header = tk.Frame(self.tab_remote, bg=BG_COLOR)
        console_header.pack(fill=tk.X, pady=(10, 0))
        
        tk.Label(console_header, text="Uzaq Server Çıxışı:", font=self.font_label, bg=BG_COLOR, fg=ACCENT_COLOR).pack(side=tk.LEFT)
        
        # Düymələr sağ tərəfdə səliqəli şəkildə sıralandı
        self.create_button(console_header, "🔄 Logları Yenilə", "#2980B9", self.refresh_remote_logs).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "📄 Kopyala", "#444", lambda: self.copy_console(self.console_remote)).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "🗑️ Konsolu Təmizlə", "#C0392B", self.clear_remote_console).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "🔍 -", "#444", self.zoom_out_remote).pack(side=tk.RIGHT, padx=2, ipadx=4)
        self.create_button(console_header, "🔍 +", "#444", self.zoom_in_remote).pack(side=tk.RIGHT, padx=2, ipadx=4)

        self.console_remote = scrolledtext.ScrolledText(self.tab_remote, height=9, bg="#0A0A0A", fg="#00FF00", font=self.font_console, relief=tk.FLAT, padx=5, pady=5)
        self.console_remote.pack(fill=tk.BOTH, expand=True, pady=5)

    # ==========================================
    # LOCAL TAB (YERLİ PC)
    # ==========================================
    def setup_local_tab(self):
        # 1. Giriş Məlumatları və Konfiqurasiya YANA-YANA (Horizontal Split)
        top_split_frame = tk.Frame(self.tab_local, bg=BG_COLOR)
        top_split_frame.pack(fill=tk.X, pady=5)
        
        # Sol tərəf: Sudo Parolu
        cred_lf = tk.LabelFrame(top_split_frame, text=" 🔐 Yerli Admin Girişi ", font=(self.font_label[0], 9, "bold"), bg=BG_COLOR, fg=ACCENT_COLOR, bd=1, relief=tk.GROOVE)
        cred_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 5), ipady=5)
        
        tk.Label(cred_lf, text="Sudo Parolu:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=0, column=0, sticky=tk.W, pady=8, padx=8)
        self.local_pass_entry = tk.Entry(cred_lf, width=28, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT, show="*")
        self.local_pass_entry.grid(row=0, column=1, pady=8, padx=8, ipady=3)
        
        # Sağ tərəf: Konfiqurasiyalar
        config_lf = tk.LabelFrame(top_split_frame, text=" ⚙️ Konfiqurasiya ", font=(self.font_label[0], 9, "bold"), bg=BG_COLOR, fg="#FFCC00", bd=1, relief=tk.GROOVE)
        config_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(5, 0), ipady=5)

        tk.Label(config_lf, text="Swap (GB):", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=0, column=0, sticky=tk.W, pady=4, padx=8)
        self.local_swap_entry = tk.Entry(config_lf, width=12, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.local_swap_entry.grid(row=0, column=1, sticky=tk.W, pady=4, padx=8, ipady=3)

        tk.Label(config_lf, text="Panel Portu:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=1, column=0, sticky=tk.W, pady=4, padx=8)
        self.local_panel_port_entry = tk.Entry(config_lf, width=12, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.local_panel_port_entry.grid(row=1, column=1, sticky=tk.W, pady=4, padx=8, ipady=3)

        tk.Label(config_lf, text="Portainer Port:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=2, column=0, sticky=tk.W, pady=4, padx=8)
        self.local_portainer_port_entry = tk.Entry(config_lf, width=12, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.local_portainer_port_entry.grid(row=2, column=1, sticky=tk.W, pady=4, padx=8, ipady=3)

        # 2. Port İdarəetmə Paneli (Lokal UFW / Iptables)
        port_mgmt_lf = tk.LabelFrame(self.tab_local, text=" 🔌 Firewall Port İdarəetməsi (UFW / Iptables) ", font=(self.font_label[0], 9, "bold"), bg=BG_COLOR, fg="#E74C3C", bd=1, relief=tk.GROOVE)
        port_mgmt_lf.pack(fill=tk.X, pady=5, ipady=5, ipadx=5)

        tk.Label(port_mgmt_lf, text="Port:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).pack(side=tk.LEFT, padx=(10, 5))
        self.local_target_port_entry = tk.Entry(port_mgmt_lf, width=8, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.local_target_port_entry.pack(side=tk.LEFT, padx=5, ipady=3)

        self.btn_local_port_open = self.create_button(port_mgmt_lf, "🔓 Portu Aç", "#27AE60", self.local_open_port)
        self.btn_local_port_open.pack(side=tk.LEFT, padx=5, ipady=3, ipadx=10)

        self.btn_local_port_close = self.create_button(port_mgmt_lf, "🔒 Portu Bağla", "#C0392B", self.local_close_port)
        self.btn_local_port_close.pack(side=tk.LEFT, padx=5, ipady=3, ipadx=10)

        self.btn_local_port_list = self.create_button(port_mgmt_lf, "📋 Portları Listələ", "#2980B9", self.local_list_ports)
        self.btn_local_port_list.pack(side=tk.LEFT, padx=10, ipady=3, ipadx=10)

        # Monitor (Lokal PC resurslarını izləmək üçün)
        self.local_monitor_frame = tk.Frame(self.tab_local, bg="#1a1a1a", highlightbackground=ACCENT_COLOR, highlightthickness=1)
        self.local_monitor_frame.pack(fill=tk.X, pady=(5, 10))
        
        self.lbl_local_cpu = tk.Label(self.local_monitor_frame, text="🟢 CPU: --", bg="#1a1a1a", fg=ACCENT_COLOR, font=("Consolas", 10, "bold"))
        self.lbl_local_cpu.pack(side=tk.LEFT, expand=True, pady=6)
        self.lbl_local_ram = tk.Label(self.local_monitor_frame, text="💾 RAM: -- / --", bg="#1a1a1a", fg="#00FF00", font=("Consolas", 10, "bold"))
        self.lbl_local_ram.pack(side=tk.LEFT, expand=True, pady=6)
        self.lbl_local_swap = tk.Label(self.local_monitor_frame, text="🔄 SWAP: -- / --", bg="#1a1a1a", fg="#FFCC00", font=("Consolas", 10, "bold"))
        self.lbl_local_swap.pack(side=tk.LEFT, expand=True, pady=6)

        # 3. Düymələr Qrupu - YANA-YANA (Horizontal Flow Layout)
        btn_frame = tk.Frame(self.tab_local, bg=BG_COLOR)
        btn_frame.pack(fill=tk.X, pady=5)
        
        # Quraşdırma & İdarəetmə Düymələri
        local_setup_lf = tk.LabelFrame(btn_frame, text=" 🛠️ Quraşdırma ", font=(self.font_label[0], 8, "bold"), bg=BG_COLOR, fg="#00FF00", bd=1, relief=tk.GROOVE)
        local_setup_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=2)
        
        self.btn_local_check = self.create_button(local_setup_lf, "🔐 İcazəni Yoxla", BTN_CHECK, self.test_local_connection)
        self.btn_local_check.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        self.btn_local_swap = self.create_button(local_setup_lf, "🔄 Swap Qur", "#E67E22", lambda: self.run_local_task(self.get_cmd_swap))
        self.btn_local_swap.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        self.btn_local_git = self.create_button(local_setup_lf, "🐙 Git Qur", "#9B59B6", lambda: self.run_local_task(self.get_cmd_git))
        self.btn_local_git.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        # Docker üçün xüsusi panel
        local_docker_frame = tk.Frame(local_setup_lf, bg=BG_COLOR)
        local_docker_frame.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5)
        
        self.btn_local_docker = self.create_button(local_docker_frame, "🐳 Docker Qur", BTN_PREP, lambda: self.run_local_task(self.get_cmd_docker))
        self.btn_local_docker.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=4)
        
        self.btn_local_docker_settings = self.create_button(local_docker_frame, "⚙️", "#444", self.open_docker_settings)
        self.btn_local_docker_settings.pack(side=tk.LEFT, padx=(2, 0), ipady=4, ipadx=4)
        
        self.btn_local_panel = self.create_button(local_setup_lf, "🚀 Paneli Qur", BTN_PANEL, lambda: self.run_local_task(self.get_cmd_panel))
        self.btn_local_panel.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        self.btn_local_all = self.create_button(local_setup_lf, "🌟 Tam Qur", BTN_ALL, lambda: self.run_local_task(self.get_cmd_all))
        self.btn_local_all.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)

        # Sistem & Xidmətlər Düymələri
        local_sys_lf = tk.LabelFrame(btn_frame, text=" 🖥️ Server & Servislər ", font=(self.font_label[0], 8, "bold"), bg=BG_COLOR, fg="#FFCC00", bd=1, relief=tk.GROOVE)
        local_sys_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=2)

        self.btn_local_clean = self.create_button(local_sys_lf, "🗑️ Təmizlə", BTN_CLEAN, lambda: self.run_local_task(self.get_cmd_clean, confirm="Bütün sistemi təmizləmək istədiyinizə əminsiniz?"))
        self.btn_local_clean.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_local_portainer = self.create_button(local_sys_lf, "🐳 Portainer", "#00A2D3", lambda: self.run_local_task(self.get_cmd_portainer))
        self.btn_local_portainer.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_local_token = self.create_button(local_sys_lf, "🔑 Token Yarat", "#8E44AD", lambda: self.trigger_portainer_token(is_local=True))
        self.btn_local_token.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)

        self.local_action_btns = [self.btn_local_swap, self.btn_local_git, self.btn_local_docker, self.btn_local_docker_settings, self.btn_local_panel, self.btn_local_all, self.btn_local_clean, self.btn_local_portainer, self.btn_local_token, self.btn_local_port_open, self.btn_local_port_close, self.btn_local_port_list]
        self.toggle_local_buttons(tk.DISABLED)

        # Konsol İdarəetmə Alətləri
        console_header = tk.Frame(self.tab_local, bg=BG_COLOR)
        console_header.pack(fill=tk.X, pady=(10, 0))
        
        tk.Label(console_header, text="Yerli PC Çıxışı:", font=self.font_label, bg=BG_COLOR, fg=ACCENT_COLOR).pack(side=tk.LEFT)
        
        # Düymələr sağ tərəfdə
        self.create_button(console_header, "📄 Kopyala", "#444", lambda: self.copy_console(self.console_local)).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "🗑️ Konsolu Təmizlə", "#C0392B", lambda: self.console_local.delete("1.0", tk.END)).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "🔍 -", "#444", self.zoom_out_local).pack(side=tk.RIGHT, padx=2, ipadx=4)
        self.create_button(console_header, "🔍 +", "#444", self.zoom_in_local).pack(side=tk.RIGHT, padx=2, ipadx=4)

        self.console_local = scrolledtext.ScrolledText(self.tab_local, height=9, bg="#0A0A0A", fg="#00FF00", font=self.font_console, relief=tk.FLAT, padx=5, pady=5)
        self.console_local.pack(fill=tk.BOTH, expand=True, pady=5)

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
                    
                    # Son yadda saxlanan pəncərə ölçüsünü tətbiq edirik
                    geom = data.get("geometry", "850x780")
                    self.root.geometry(geom)
            else:
                self.user_entry.insert(0, "ubuntu")
                self.swap_entry.insert(0, "2")
                self.local_swap_entry.insert(0, "2")
                self.panel_port_entry.insert(0, "3000")
                self.local_panel_port_entry.insert(0, "3000")
                self.portainer_port_entry.insert(0, "9000")
                self.local_portainer_port_entry.insert(0, "9000")
                self.root.geometry("850x780")
        except: 
            self.root.geometry("850x780")

    def save_window_geometry(self):
        # Yalnız pəncərə normal vəziyyətdə olanda ölçüsünü save edirik (minimize olanda yox)
        if self.root.state() == "normal":
            self.save_config()

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
                
            # Hazırkı pəncərə ölçüsünü alırıq
            geom = self.root.geometry()
            
            data = {
                "ip": self.ip_entry.get().strip(),
                "user": self.user_entry.get().strip(),
                "key": self.key_entry.get().strip(),
                "swap": swap_val,
                "panel_port": panel_val,
                "portainer_port": portainer_val,
                "geometry": geom
            }
            with open("config.json", "w") as f:
                json.dump(data, f)
        except: pass

    # ==========================================
    # FIREWALL PORT MANAGEMENT (REMOTE & LOCAL)
    # ==========================================
    def remote_open_port(self):
        port = self.target_port_entry.get().strip()
        if not port:
            messagebox.showwarning("Xəta", "Açılacaq port nömrəsini daxil edin!")
            return
        cmd = f"sudo ufw allow {port}/tcp 2>/dev/null || sudo iptables -I INPUT -p tcp --dport {port} -j ACCEPT"
        self.run_remote_task(lambda s, p, pr: f"echo 'Uzaq serverdə {port} portu açılır...'; {cmd} && echo '✅ Port {port} uğurla açıldı!'")

    def remote_close_port(self):
        port = self.target_port_entry.get().strip()
        if not port:
            messagebox.showwarning("Xəta", "Bağlanacaq port nömrəsini daxil edin!")
            return
        cmd = f"sudo ufw delete allow {port}/tcp 2>/dev/null || sudo iptables -D INPUT -p tcp --dport {port} -j ACCEPT"
        self.run_remote_task(lambda s, p, pr: f"echo 'Uzaq serverdə {port} portu bağlanır...'; {cmd} && echo '✅ Port {port} bağlandı!'")

    def remote_list_ports(self):
        cmd = "sudo ufw status verbose 2>/dev/null || sudo iptables -L -n -v"
        self.run_remote_task(lambda s, p, pr: f"echo 'Uzaq serverdə aktiv portlar listələnir...'; {cmd}")

    def local_open_port(self):
        port = self.local_target_port_entry.get().strip()
        if not port:
            messagebox.showwarning("Xəta", "Açılacaq port nömrəsini daxil edin!")
            return
        cmd = f"sudo ufw allow {port}/tcp 2>/dev/null || sudo iptables -I INPUT -p tcp --dport {port} -j ACCEPT"
        self.run_local_task(lambda s, p, pr: f"echo 'Lokal PC-də {port} portu açılır...'; {cmd} && echo '✅ Port {port} uğurla açıldı!'")

    def local_close_port(self):
        port = self.local_target_port_entry.get().strip()
        if not port:
            messagebox.showwarning("Xəta", "Bağlanacaq port nömrəsini daxil edin!")
            return
        cmd = f"sudo ufw delete allow {port}/tcp 2>/dev/null || sudo iptables -D INPUT -p tcp --dport {port} -j ACCEPT"
        self.run_local_task(lambda s, p, pr: f"echo 'Lokal PC-də {port} portu bağlanır...'; {cmd} && echo '✅ Port {port} bağlandı!'")

    def local_list_ports(self):
        cmd = "sudo ufw status verbose 2>/dev/null || sudo iptables -L -n -v"
        self.run_local_task(lambda s, p, pr: f"echo 'Lokal PC-də aktiv portlar listələnir...'; {cmd}")



    # ==========================================
    # TOGGLE BUTTONS
    # ==========================================
    def toggle_remote_buttons(self, state):
        for btn in self.remote_action_btns:
            btn.config(state=state)
            if state == tk.DISABLED:
                btn.config(bg="#333333", fg="#888888")
            else:
                if btn == self.btn_swap: btn.config(bg="#E67E22", fg="white")
                elif btn == self.btn_git: btn.config(bg="#9B59B6", fg="white")
                elif btn == self.btn_docker: btn.config(bg=BTN_PREP, fg="white")
                elif btn == self.btn_docker_settings: btn.config(bg="#444", fg="white")
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
                if btn == self.btn_local_swap: btn.config(bg="#E67E22", fg="white")
                elif btn == self.btn_local_git: btn.config(bg="#9B59B6", fg="white")
                elif btn == self.btn_local_docker: btn.config(bg=BTN_PREP, fg="white")
                elif btn == self.btn_local_docker_settings: btn.config(bg="#444", fg="white")
                elif btn == self.btn_local_panel: btn.config(bg=BTN_PANEL, fg="white")
                elif btn == self.btn_local_all: btn.config(bg=BTN_ALL, fg="white")
                elif btn == self.btn_local_clean: btn.config(bg=BTN_CLEAN, fg="white")
                elif btn == self.btn_local_portainer: btn.config(bg="#00A2D3", fg="white")
                elif btn == getattr(self, 'btn_local_token', None): btn.config(bg="#8E44AD", fg="white")
                elif btn == self.btn_local_port_open: btn.config(bg="#27AE60", fg="white")
                elif btn == self.btn_local_port_close: btn.config(bg="#C0392B", fg="white")
                elif btn == self.btn_local_port_list: btn.config(bg="#2980B9", fg="white")

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
    def open_docker_settings(self):
        win = tk.Toplevel(self.root)
        win.title("🐳 Docker Komponent Ayarları")
        win.geometry("380x280")
        win.configure(bg=CARD_COLOR)
        win.resizable(False, False)
        
        # Pəncərənin mərkəzdə açılması
        win.transient(self.root)
        win.grab_set()
        
        tk.Label(win, text="Quraşdırılacaq Komponentlər:", font=self.font_label, bg=CARD_COLOR, fg=ACCENT_COLOR).pack(pady=10)
        
        frame = tk.Frame(win, bg=CARD_COLOR)
        frame.pack(fill=tk.BOTH, expand=True, padx=20)
        
        style_check = {"bg": CARD_COLOR, "fg": TEXT_COLOR, "selectcolor": "#2D2D2D", "activebackground": CARD_COLOR, "activeforeground": TEXT_COLOR, "font": self.font_label}
        
        tk.Checkbutton(frame, text="Docker Engine (Əsas mühərrik)", variable=self.docker_engine_var, **style_check).pack(anchor=tk.W, pady=3)
        tk.Checkbutton(frame, text="Docker CLI (Terminal əmrləri)", variable=self.docker_cli_var, **style_check).pack(anchor=tk.W, pady=3)
        tk.Checkbutton(frame, text="Docker Buildx Plugin (Geniş build)", variable=self.docker_buildx_var, **style_check).pack(anchor=tk.W, pady=3)
        tk.Checkbutton(frame, text="Docker Compose Plugin (Konfiqurasiya)", variable=self.docker_compose_var, **style_check).pack(anchor=tk.W, pady=3)
        tk.Checkbutton(frame, text="containerd.io (Konteyner idarəçi)", variable=self.docker_containerd_var, **style_check).pack(anchor=tk.W, pady=3)
        
        self.create_button(win, "💾 Yadda Saxla", BTN_ALL, win.destroy).pack(pady=15, ipady=4, ipadx=15)

    def get_cmd_swap(self, swap_gb, panel_p, port_p):
        swap_mb = int(swap_gb) * 1024
        return f"""
echo 'Swap ({swap_gb}GB) Sazlanır...';
if grep -q '/swapfile' /proc/swaps; then
    echo 'Mövcud Swap söndürülür...';
    sudo swapoff /swapfile;
    sudo rm -f /swapfile;
fi;
sudo fallocate -l {swap_gb}G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count={swap_mb};
sudo chmod 600 /swapfile;
sudo mkswap /swapfile;
sudo swapon /swapfile;
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab;
sudo sysctl vm.swappiness=10;
echo '✅ {swap_gb}GB Swap uğurla quruldu və aktivləşdirildi!';
"""

    def get_cmd_git(self, swap_gb, panel_p, port_p):
        return """
echo 'Git yoxlanılır...';
if ! command -v git > /dev/null 2>&1; then
    echo 'Git tapılmadı. Quraşdırılır...';
    if command -v apt-get > /dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y git;
    elif command -v yum > /dev/null 2>&1; then
        sudo yum install -y git;
    elif command -v apk > /dev/null 2>&1; then
        sudo apk add git;
    else
        echo '❌ Dəstəklənməyən paket meneceri! Git-i əllə qurun.';
        exit 1;
    fi;
    echo '✅ Git uğurla quraşdırıldı!';
else
    echo '✅ Git artıq mövcuddur: '$(git --version);
fi;
"""

    def get_cmd_docker(self, swap_gb, panel_p, port_p):
        # Seçilən komponentlərin siyahısını hazırlayırıq
        pkgs = []
        if self.docker_engine_var.get(): pkgs.append("docker-ce")
        if self.docker_cli_var.get(): pkgs.append("docker-ce-cli")
        if self.docker_containerd_var.get(): pkgs.append("containerd.io")
        if self.docker_buildx_var.get(): pkgs.append("docker-buildx-plugin")
        if self.docker_compose_var.get(): pkgs.append("docker-compose-plugin")
        
        pkg_str = " ".join(pkgs)
        
        return f"""
echo 'Seçilmiş Docker komponentləri qurulur: {pkg_str}';
if command -v apt-get > /dev/null 2>&1; then
    sudo apt-get update && \
    sudo apt-get install -y ca-certificates curl gnupg lsb-release && \
    sudo mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | sudo gpg --dearmor -y --o /etc/apt/keyrings/docker.gpg 2>/dev/null || true && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    sudo apt-get update && \
    sudo apt-get install -y {pkg_str};
else
    echo 'APT tapılmadı. Skript ilə standart Docker quraşdırılır...';
    curl -fsSL https://get.docker.com -o get-docker.sh;
    sudo sh get-docker.sh;
fi;

# Əgər buildx seçilibsə və apt-dən əlavə edilməyibsə, əlavə yoxlama
{"if ! docker buildx version > /dev/null 2>&1 && command -v apt-get > /dev/null 2>&1; then sudo apt-get install -y docker-buildx || true; fi" if self.docker_buildx_var.get() else ""}

sudo systemctl enable docker 2>/dev/null || true;
sudo systemctl start docker 2>/dev/null || true;
sudo usermod -aG docker $USER 2>/dev/null || true;
echo '✅ Docker quraşdırılması seçilmiş komponentlərlə tamamlandı!';
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
echo '⏳ QEYD: Docker imicinin həcmi böyükdür (~400MB). Yüklənməsi 2-5 dəqiqə çəkə bilər. Lütfən ekran donmuş kimi görünsə də gözləyin...';
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
    if command -v apt-get > /dev/null 2>&1; then
        sudo apt-get update && \
        sudo apt-get install -y ca-certificates curl gnupg lsb-release && \
        sudo mkdir -p /etc/apt/keyrings && \
        curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | sudo gpg --dearmor -y --o /etc/apt/keyrings/docker.gpg 2>/dev/null || true && \
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null && \
        sudo apt-get update && \
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin;
    else
        curl -fsSL https://get.docker.com -o get-docker.sh; 
        sudo sh get-docker.sh;
    fi;
    if ! docker buildx version > /dev/null 2>&1; then
        if command -v apt-get > /dev/null 2>&1; then
            sudo apt-get install -y docker-buildx || sudo apt-get install -y docker-buildx-plugin || true;
        fi;
    fi;
    sudo systemctl enable docker; sudo systemctl start docker; sudo usermod -aG docker $USER;
else
    if ! docker buildx version > /dev/null 2>&1; then
        if command -v apt-get > /dev/null 2>&1; then
            sudo apt-get update && (sudo apt-get install -y docker-buildx-plugin || sudo apt-get install -y docker-buildx || true);
        fi;
    fi;
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


        
    def remote_open_port(self):
        port = self.target_port_entry.get().strip()
        if not port.isdigit():
            messagebox.showwarning("Xəta", "Zəhmət olmasa düzgün port daxil edin (məs: 8080)!")
            return
        
        ip = self.ip_entry.get().strip()
        user = self.user_entry.get().strip()
        key_path = self.key_entry.get().strip()
        
        # Konfiqurasiya edilən xüsusi portları alırıq
        panel_port = self.panel_port_entry.get().strip() or "3000"
        portainer_port = self.portainer_port_entry.get().strip() or "9000"
        
        self.log_remote(f"\n--- Port {port} uzaq serverdə açılır və xidmət aktivləşdirilir ({ip}) ---")
        
        # 1. Portu tapmaq üçün əvvəlcə standart port siyahısından süzürük
        # 2. Əgər Ports sütunu boşdursa, port dəyərinə görə (3000 -> masterdeploy, 8000/9000 -> portainer) birbaşa adla tapırıq
        cmd = f"""
        sudo ufw allow {port}/tcp 2>/dev/null || true; 
        sudo iptables -I INPUT -p tcp --dport {port} -j ACCEPT 2>/dev/null || true;
        sudo iptables -D DOCKER-USER -p tcp --dport {port} -j DROP 2>/dev/null || true;
        
        # Süzgəclə axtarış
        container_id=$(sudo docker ps -a --format "{{{{.ID}}}} {{{{.Ports}}}}" | grep -E "[:]{port}->|[^0-9]{port}->" | awk '{{print $1}}' | head -n 1)
        
        # Əgər süzgəclə tapılmasa (çünki dayandırılmış konteynerin portu siyahıda görünmür), ad uyğunluğuna görə tapırıq
        if [ -z "$container_id" ]; then
            if [ "{port}" = "{panel_port}" ]; then
                container_id=$(sudo docker ps -a --filter name=masterdeploy --format "{{{{.ID}}}}" | head -n 1)
            elif [ "{port}" = "{portainer_port}" ] || [ "{port}" = "8000" ] || [ "{port}" = "9000" ]; then
                container_id=$(sudo docker ps -a --filter name=portainer --format "{{{{.ID}}}}" | head -n 1)
            fi
        fi
        
        if [ ! -z "$container_id" ]; then
            echo "Konteyner tapıldı ($container_id), arxa planda restart edilir..."
            nohup sudo docker restart $container_id >/dev/null 2>&1 &
        else
            echo "Bu portda heç bir konteyner tapılmadı (adi firewall portu kimi açıldı)."
        fi
        sudo netfilter-persistent save 2>/dev/null || true;
        """
        
        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=creationflags)
            if proc.returncode == 0:
                self.log_remote(proc.stdout)
                self.log_remote(f"✅ Port {port} açıldı və xidmət işə salındı!")
            else:
                self.log_remote(f"❌ Port açılarkən xəta: {proc.stderr}")
        threading.Thread(target=task, daemon=True).start()

    def remote_close_port(self):
        port = self.target_port_entry.get().strip()
        if not port.isdigit():
            messagebox.showwarning("Xəta", "Zəhmət olmasa düzgün port daxil edin (məs: 8080)!")
            return
            
        ip = self.ip_entry.get().strip()
        user = self.user_entry.get().strip()
        key_path = self.key_entry.get().strip()
        panel_port = self.panel_port_entry.get().strip() or "3000"
        portainer_port = self.portainer_port_entry.get().strip() or "9000"
        
        self.log_remote(f"\n--- Port {port} uzaq serverdə bağlanır və xidmət dayandırılır ({ip}) ---")
        
        cmd = f"""
        # Portu dəqiq mətndən süzərək konteyner ID-sini tapırıq
        container_ids=$(sudo docker ps -a --format "{{{{.ID}}}} {{{{.Ports}}}}" | grep -E "[:]{port}->|[^0-9]{port}->" | awk '{{print $1}}')
        
        # Əgər boşdursa və bizdən panel/portainer portu tələb olunubsa, birbaşa adla axtarırıq
        if [ -z "$container_ids" ]; then
            if [ "{port}" = "{panel_port}" ]; then
                container_ids=$(sudo docker ps -a --filter name=masterdeploy --format "{{{{.ID}}}}")
            elif [ "{port}" = "{portainer_port}" ] || [ "{port}" = "8000" ] || [ "{port}" = "9000" ]; then
                container_ids=$(sudo docker ps -a --filter name=portainer --format "{{{{.ID}}}}")
            fi
        fi
        
        if [ ! -z "$container_ids" ]; then
            echo "Konteynerlər tapıldı, arxa planda dayandırılır..."
            nohup sudo docker stop $container_ids >/dev/null 2>&1 &
        else
            echo "Bu portu işlədən aktiv konteyner tapılmadı (adi firewall portu kimi qapandı)."
        fi
        
        sudo ufw delete allow {port}/tcp 2>/dev/null || true; 
        sudo iptables -D INPUT -p tcp --dport {port} -j ACCEPT 2>/dev/null || true;
        sudo iptables -I DOCKER-USER -p tcp --dport {port} -j DROP 2>/dev/null || true;
        sudo netfilter-persistent save 2>/dev/null || true;
        """
        
        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=creationflags)
            if proc.returncode == 0:
                self.log_remote(f"✅ Port {port} uğurla bağlandı və arxadakı xidmətlər dayandırıldı!")
            else:
                self.log_remote(f"❌ Port bağlanarkən xəta: {proc.stderr}")
        threading.Thread(target=task, daemon=True).start()

    def remote_list_ports(self):
        ip = self.ip_entry.get().strip()
        user = self.user_entry.get().strip()
        key_path = self.key_entry.get().strip()
        
        self.log_remote(f"\n--- Uzaq serverdəki Açıq Portların siyahısı ({ip}) ---")
        
        # Portların nə üçün istifadə olunduğunu izah edən bash skripti
        cmd = """
        echo '=== AÇIQ TCP PORTLARI (Aktiv işləyən xidmətlər) ==='
        # Həm portu, həm də işləyən proqramın adını çıxarır
        sudo ss -tlnp | awk 'NR>1 {
            split($4, a, ":"); 
            port=a[length(a)]; 
            split($6, b, "\\""); 
            proc=b[2];
            if(proc=="") proc="Bilinməyən xidmət";
            print "-> Port: " port " [" proc "]"
        }' | sort -V
        
        echo ''
        echo '=== IPTABLES İCAZƏ VERİLƏN PORTLAR (Server daxilində açılmış qapılar) ==='
        # Hər bir icazə verilən portu və standart adını göstərir, DOCKER-USER bloklamalarını da yoxlayır
        sudo iptables -L INPUT -n --line-numbers | grep -i 'ACCEPT' | grep -oE 'dpt:[0-9]+|dports [0-9:,]+' | sed 's/dpt://' | sed 's/dports //' | tr ',' '\\n' | sort -nu | while read -r port; do
            if [ ! -z "$port" ]; then
                # Docker-User tərəfindən bloklanıb-bloklanmadığını yoxlayaq
                is_blocked=$(sudo iptables -L DOCKER-USER -n | grep -i 'DROP' | grep -w "dpt:$port" || echo "")
                
                service="Fərdi Xidmət"
                case "$port" in
                    22) service="SSH (Serverə Qoşulma)" ;;
                    80) service="HTTP (Veb Server)" ;;
                    443) service="HTTPS (Təhlükəsiz Veb)" ;;
                    3000) service="MasterDeploy Paneli" ;;
                    7000) service="Portainer Agent (Daxili)" ;;
                    8000) service="Portainer Veb (HTTP)" ;;
                    9000) service="Portainer Veb (Alternativ HTTP)" ;;
                    9443) service="Portainer Veb (HTTPS)" ;;
                    8080) service="Test/Alternativ Veb Portu" ;;
                esac
                
                if [ ! -z "$is_blocked" ]; then
                    echo "-> Port: $port ($service) [❌ DOCKER SƏVİYYƏSİNDƏ BLOKLANIB]"
                else
                    echo "-> Port: $port ($service) [✅ AÇIQ]"
                fi
            fi
        done
        if [ -z "$(sudo iptables -L INPUT -n | grep -i 'ACCEPT' | grep -oE 'dpt:[0-9]+|dports [0-9:,]+')" ]; then
            echo 'iptables-da xüsusi port məhdudiyyəti yoxdur.'
        fi
        
        echo ''
        echo '⚠️ QEYD: Əgər yuxarıdakı portlardan hansısa Oracle Cloud panelində (Security Rules) açılmayıbsa, ona kənardan (internetdən) daxil olmaq mümkün olmayacaq.'
        """
        
        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=creationflags)
            if proc.returncode == 0:
                self.log_remote(proc.stdout or "Məlumat yoxdur.")
            else:
                self.log_remote(f"❌ Portlar siyahılaşdırılarkən xəta: {proc.stderr or 'Bilinməyən qoşulma xətası'}")
        threading.Thread(target=task, daemon=True).start()

    def zoom_in_remote(self):
        try:
            # Hazırkı şriftin ölçüsünü artırırıq
            current_size = self.font_console[1]
            if current_size < 24:
                self.font_console = (self.font_console[0], current_size + 1)
                self.console_remote.configure(font=self.font_console)
        except: pass

    def zoom_out_remote(self):
        try:
            # Hazırkı şriftin ölçüsünü azaldırıq
            current_size = self.font_console[1]
            if current_size > 6:
                self.font_console = (self.font_console[0], current_size - 1)
                self.console_remote.configure(font=self.font_console)
        except: pass

    def clear_remote_console(self):
        self.console_remote.delete("1.0", tk.END)

    def refresh_remote_logs(self):
        ip = self.ip_entry.get().strip()
        user = self.user_entry.get().strip()
        key_path = self.key_entry.get().strip()
        if not ip or not user or not key_path:
            messagebox.showwarning("Xəta", "Server məlumatları əskikdir!")
            return
            
        self.log_remote("\n--- Arxa plandakı mövcud quraşdırma logları çəkilir... ---")
        
        def task():
            # Serverdə işləyən tapşırığın ən son 50 sətrini çəkirik
            cmd = "tail -n 50 /tmp/mini_masterdeploy.log 2>/dev/null || echo 'Aktiv tapşırıq logu tapılmadı.'"
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=creationflags)
            if proc.returncode == 0:
                self.log_remote(proc.stdout)
            else:
                self.log_remote("❌ Loglar yenilənə bilmədi: Serverə qoşulmaq olmur.")
        threading.Thread(target=task, daemon=True).start()

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
        
        # Yerli PC monitorinqini də arxa planda başladaq
        threading.Thread(target=self.local_monitor_loop, daemon=True).start()
        
        while self.monitoring_active:
            try:
                if ip:
                    ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=3", "-i", key_path, f"{user}@{ip}", cmd]
                    creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                    process = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=creationflags)
                    out, _ = process.communicate(timeout=4)
                    if process.returncode == 0:
                        lines = out.strip().split('\n')
                        if len(lines) >= 3:
                            r_tot, r_used = float(lines[0].split()[0])/1024, float(lines[0].split()[1])/1024
                            s_tot, s_used = float(lines[1].split()[0])/1024, float(lines[1].split()[1])/1024
                            cpu = lines[2]
                            self.root.after(0, self.update_monitor, r_used, r_tot, s_used, s_tot, cpu, False)
            except Exception:
                pass
            time.sleep(6)

    def local_monitor_loop(self):
        import time
        # Linux Mint/Lokal Linux üçün resurs yoxlama əmri
        cmd = "free -m | awk 'NR==2{print $2,$3}; NR==3{print $2,$3}'; cat /proc/loadavg | awk '{print $1}'"
        while self.monitoring_active:
            try:
                if os.name != 'nt': # Yalnız Linux sistemlərdə işləsin
                    process = subprocess.Popen(["bash", "-c", cmd], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    out, _ = process.communicate(timeout=3)
                    if process.returncode == 0:
                        lines = out.strip().split('\n')
                        if len(lines) >= 3:
                            r_tot, r_used = float(lines[0].split()[0])/1024, float(lines[0].split()[1])/1024
                            s_tot, s_used = float(lines[1].split()[0])/1024, float(lines[1].split()[1])/1024
                            cpu = lines[2]
                            self.root.after(0, self.update_monitor, r_used, r_tot, s_used, s_tot, cpu, True)
            except Exception:
                pass
            time.sleep(6)

    def update_monitor(self, ram_u, ram_t, swap_u, swap_t, cpu, is_local=False):
        lbl_c = self.lbl_local_cpu if is_local else self.lbl_cpu
        lbl_r = self.lbl_local_ram if is_local else self.lbl_ram
        lbl_s = self.lbl_local_swap if is_local else self.lbl_swap
        
        lbl_c.config(text=f"🟢 CPU: {cpu}")
        lbl_r.config(text=f"💾 RAM: {ram_u:.2f}GB / {ram_t:.2f}GB")
        if swap_t > 0: 
            lbl_s.config(text=f"🔄 SWAP: {swap_u:.2f}GB / {swap_t:.2f}GB")
        else: 
            lbl_s.config(text="🔄 SWAP: Yoxdur")

    # Zoom funksiyaları (Konsol font ölçüsünü tənzimləmək üçün)
    def zoom_in_remote(self):
        self.change_font_size(self.console_remote, 1)

    def zoom_out_remote(self):
        self.change_font_size(self.console_remote, -1)

    def zoom_in_local(self):
        self.change_font_size(self.console_local, 1)

    def zoom_out_local(self):
        self.change_font_size(self.console_local, -1)

    def change_font_size(self, text_widget, delta):
        try:
            current_font = text_widget.cget("font")
            # Font adı və ölçüsünü parse edirik
            if isinstance(current_font, str):
                parts = current_font.split()
                if len(parts) >= 2:
                    font_family = parts[0]
                    font_size = max(6, min(24, int(parts[1]) + delta))
                    text_widget.config(font=(font_family, font_size))
            elif isinstance(current_font, tuple) or isinstance(current_font, list):
                font_family = current_font[0]
                font_size = max(6, min(24, current_font[1] + delta))
                text_widget.config(font=(font_family, font_size))
        except Exception:
            pass

if __name__ == "__main__":
    root = tk.Tk()
    app = RemoteInstallerGUI(root)
    root.mainloop()
