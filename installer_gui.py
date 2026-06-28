import os
import json
import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

# Colors (Dark Mode)
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
    def __init__(self, root, backend):
        self.root = root
        self.backend = backend
        self.backend.gui = self  # Backend-in GUI-a müraciət edə bilməsi üçün
        
        self.root.title("MasterDeploy Quraşdırıcı 🚀 (Remote & Local)")
        self.root.configure(bg=BG_COLOR, padx=20, pady=10)
        
        # Docker Options Variables
        self.docker_engine_var = tk.BooleanVar(value=True)
        self.docker_cli_var = tk.BooleanVar(value=True)
        self.docker_buildx_var = tk.BooleanVar(value=True)
        self.docker_compose_var = tk.BooleanVar(value=True)
        self.docker_containerd_var = tk.BooleanVar(value=True)
        
        # Fonts
        self.font_title = ("Segoe UI", 16, "bold")
        self.font_label = ("Segoe UI", 10, "bold")
        self.font_entry = ("Segoe UI", 10)
        self.font_btn = ("Segoe UI", 9, "bold")
        self.font_console = ("Consolas", 9)

        # Window geometry load
        self.backend.load_config()
        self.root.bind("<Configure>", lambda e: self.backend.save_window_geometry())

        # Tabs
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
        
        # Build Tabs
        self.setup_remote_tab()
        self.setup_local_tab()
        
        self.backend.load_config()
        
        if self.ip_entry.get() and self.key_entry.get():
            self.root.after(500, lambda: self.backend.test_connection(auto=True))

    def create_button(self, parent, text, bg_color, command, **kwargs):
        fg_color = kwargs.pop("fg", "white")
        btn = tk.Button(parent, text=text, bg=bg_color, fg=fg_color, font=self.font_btn, 
                        relief=tk.FLAT, borderwidth=0, cursor="hand2", 
                        activebackground="#555", activeforeground="white", command=command, **kwargs)
        return btn

    def setup_remote_tab(self):
        top_split_frame = tk.Frame(self.tab_remote, bg=BG_COLOR)
        top_split_frame.pack(fill=tk.X, pady=5)
        
        # Credentials Group
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

        # Config Group
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

        # Port Management
        port_mgmt_lf = tk.LabelFrame(self.tab_remote, text=" 🔌 Firewall Port İdarəetməsi (UFW / Iptables) ", font=(self.font_label[0], 9, "bold"), bg=BG_COLOR, fg="#E74C3C", bd=1, relief=tk.GROOVE)
        port_mgmt_lf.pack(fill=tk.X, pady=5, ipady=5, ipadx=5)

        fw_status_frame = tk.Frame(port_mgmt_lf, bg=BG_COLOR)
        fw_status_frame.pack(fill=tk.X, pady=2, padx=5)

        self.lbl_fw_status = tk.Label(fw_status_frame, text="Firewall: Yoxlanılır... ⏳", font=self.font_label, bg=BG_COLOR, fg="#FFF")
        self.lbl_fw_status.pack(side=tk.LEFT, padx=5)

        self.btn_fw_toggle = self.create_button(fw_status_frame, "⚡ Firewall Deaktiv Et", "#D35400", self.backend.toggle_remote_fw)
        self.btn_fw_toggle.pack(side=tk.LEFT, padx=10, ipady=2)

        port_action_frame = tk.Frame(port_mgmt_lf, bg=BG_COLOR)
        port_action_frame.pack(fill=tk.X, pady=4, padx=5)

        tk.Label(port_action_frame, text="Port:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).pack(side=tk.LEFT, padx=(5, 5))
        self.target_port_entry = tk.Entry(port_action_frame, width=8, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.target_port_entry.pack(side=tk.LEFT, padx=5, ipady=3)

        self.btn_port_check = self.create_button(port_action_frame, "🔄 Portu Yoxla", "#2980B9", self.backend.check_remote_port_status)
        self.btn_port_check.pack(side=tk.LEFT, padx=5, ipady=3)

        self.btn_port_toggle = self.create_button(port_action_frame, "🔓 Portu Aç", "#27AE60", self.backend.toggle_remote_port)
        self.btn_port_toggle.pack(side=tk.LEFT, padx=5, ipady=3)

        self.lbl_port_status = tk.Label(port_action_frame, text="Vəziyyət: -- ⏳", font=self.font_label, bg=BG_COLOR, fg="#FFF")
        self.lbl_port_status.pack(side=tk.LEFT, padx=10)

        self.btn_port_list = self.create_button(port_action_frame, "📋 İcazəliləri Listələ", "#8E44AD", self.backend.remote_list_ports)
        self.btn_port_list.pack(side=tk.LEFT, padx=10, ipady=3)

        # Monitor Frame
        self.monitor_frame = tk.Frame(self.tab_remote, bg="#1a1a1a", highlightbackground=ACCENT_COLOR, highlightthickness=1)
        self.monitor_frame.pack(fill=tk.X, pady=(5, 10))
        
        self.lbl_cpu = tk.Label(self.monitor_frame, text="🟢 CPU: --", bg="#1a1a1a", fg=ACCENT_COLOR, font=("Consolas", 10, "bold"))
        self.lbl_cpu.pack(side=tk.LEFT, expand=True, pady=6)
        self.lbl_ram = tk.Label(self.monitor_frame, text="💾 RAM: -- / --", bg="#1a1a1a", fg="#00FF00", font=("Consolas", 10, "bold"))
        self.lbl_ram.pack(side=tk.LEFT, expand=True, pady=6)
        self.lbl_swap = tk.Label(self.monitor_frame, text="🔄 SWAP: -- / --", bg="#1a1a1a", fg="#FFCC00", font=("Consolas", 10, "bold"))
        self.lbl_swap.pack(side=tk.LEFT, expand=True, pady=6)

        # Action Buttons Group
        btn_action_frame = tk.Frame(self.tab_remote, bg=BG_COLOR)
        btn_action_frame.pack(fill=tk.X, pady=5)
        
        setup_lf = tk.LabelFrame(btn_action_frame, text=" 🛠️ Quraşdırma ", font=(self.font_label[0], 8, "bold"), bg=BG_COLOR, fg="#00FF00", bd=1, relief=tk.GROOVE)
        setup_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=2)
        
        self.btn_check = self.create_button(setup_lf, "🔗 Yoxla", BTN_CHECK, self.backend.test_connection)
        self.btn_check.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        self.btn_swap = self.create_button(setup_lf, "🔄 Swap Qur", "#E67E22", lambda: self.backend.run_remote_task(self.backend.get_cmd_swap))
        self.btn_swap.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        self.btn_git = self.create_button(setup_lf, "🐙 Git Qur", "#9B59B6", lambda: self.backend.run_remote_task(self.backend.get_cmd_git))
        self.btn_git.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        docker_btn_frame = tk.Frame(setup_lf, bg=BG_COLOR)
        docker_btn_frame.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5)
        
        self.btn_docker = self.create_button(docker_btn_frame, "🐳 Docker Qur", BTN_PREP, lambda: self.backend.run_remote_task(self.backend.get_cmd_docker))
        self.btn_docker.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=4)
        
        self.btn_docker_settings = self.create_button(docker_btn_frame, "⚙️", "#444", self.open_docker_settings)
        self.btn_docker_settings.pack(side=tk.LEFT, padx=(2, 0), ipady=4, ipadx=4)
        
        self.btn_panel = self.create_button(setup_lf, "🚀 Paneli Qur", BTN_PANEL, lambda: self.backend.run_remote_task(self.backend.get_cmd_panel))
        self.btn_panel.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        
        self.btn_all = self.create_button(setup_lf, "🌟 Tam Qur", BTN_ALL, lambda: self.backend.run_remote_task(self.backend.get_cmd_all))
        self.btn_all.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)

        sys_lf = tk.LabelFrame(btn_action_frame, text=" 🖥️ Server & Servislər ", font=(self.font_label[0], 8, "bold"), bg=BG_COLOR, fg="#FFCC00", bd=1, relief=tk.GROOVE)
        sys_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=2)

        self.btn_reboot = self.create_button(sys_lf, "🔄 Restart", BTN_REBOOT, self.backend.remote_reboot, fg="black")
        self.btn_reboot.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_clean = self.create_button(sys_lf, "🗑️ Təmizlə", BTN_CLEAN, lambda: self.backend.run_remote_task(self.backend.get_cmd_clean, confirm="Serveri tamamilə sıfırlamaq istəyirsiniz?"))
        self.btn_clean.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_portainer = self.create_button(sys_lf, "🐳 Portainer", "#00A2D3", lambda: self.backend.run_remote_task(self.backend.get_cmd_portainer))
        self.btn_portainer.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_token = self.create_button(sys_lf, "🔑 Token Yarat", "#8E44AD", lambda: self.backend.trigger_portainer_token(is_local=False))
        self.btn_token.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)

        self.remote_action_btns = [self.btn_swap, self.btn_git, self.btn_docker, self.btn_docker_settings, self.btn_panel, self.btn_all, self.btn_reboot, self.btn_clean, self.btn_portainer, self.btn_token, self.btn_port_check, self.btn_port_toggle]
        self.toggle_remote_buttons(tk.DISABLED)

        # Console Header
        console_header = tk.Frame(self.tab_remote, bg=BG_COLOR)
        console_header.pack(fill=tk.X, pady=(10, 0))
        
        tk.Label(console_header, text="Uzaq Server Çıxışı:", font=self.font_label, bg=BG_COLOR, fg=ACCENT_COLOR).pack(side=tk.LEFT)
        
        self.create_button(console_header, "🔄 Logları Yenilə", "#2980B9", self.backend.refresh_remote_logs).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "📄 Kopyala", "#444", lambda: self.backend.copy_console(self.console_remote)).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "🗑️ Konsolu Təmizlə", "#C0392B", self.backend.clear_remote_console).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "🔍 -", "#444", self.zoom_out_remote).pack(side=tk.RIGHT, padx=2, ipadx=4)
        self.create_button(console_header, "🔍 +", "#444", self.zoom_in_remote).pack(side=tk.RIGHT, padx=2, ipadx=4)

        self.console_remote = scrolledtext.ScrolledText(self.tab_remote, height=9, bg="#0A0A0A", fg="#00FF00", font=self.font_console, relief=tk.FLAT, padx=5, pady=5)
        self.console_remote.pack(fill=tk.BOTH, expand=True, pady=5)

    def setup_local_tab(self):
        top_split_frame = tk.Frame(self.tab_local, bg=BG_COLOR)
        top_split_frame.pack(fill=tk.X, pady=5)
        
        cred_lf = tk.LabelFrame(top_split_frame, text=" 🔐 Administrator İcazəsi ", font=(self.font_label[0], 9, "bold"), bg=BG_COLOR, fg=ACCENT_COLOR, bd=1, relief=tk.GROOVE)
        cred_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 5), ipady=5)
        
        tk.Label(cred_lf, text="Sudo Parolu:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).grid(row=0, column=0, sticky=tk.W, pady=4, padx=8)
        self.local_pass_entry = tk.Entry(cred_lf, width=22, font=self.font_entry, bg=ENTRY_BG, fg="white", show="*", insertbackground="white", relief=tk.FLAT)
        self.local_pass_entry.grid(row=0, column=1, pady=4, padx=8, ipady=3)

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

        port_mgmt_lf = tk.LabelFrame(self.tab_local, text=" 🔌 Firewall Port İdarəetməsi (UFW / Iptables) ", font=(self.font_label[0], 9, "bold"), bg=BG_COLOR, fg="#E74C3C", bd=1, relief=tk.GROOVE)
        port_mgmt_lf.pack(fill=tk.X, pady=5, ipady=5, ipadx=5)

        local_fw_status_frame = tk.Frame(port_mgmt_lf, bg=BG_COLOR)
        local_fw_status_frame.pack(fill=tk.X, pady=2, padx=5)

        self.lbl_local_fw_status = tk.Label(local_fw_status_frame, text="Firewall: Yoxlanılır... ⏳", font=self.font_label, bg=BG_COLOR, fg="#FFF")
        self.lbl_local_fw_status.pack(side=tk.LEFT, padx=5)

        self.btn_local_fw_toggle = self.create_button(local_fw_status_frame, "⚡ Firewall Deaktiv Et", "#D35400", self.backend.toggle_local_fw)
        self.btn_local_fw_toggle.pack(side=tk.LEFT, padx=10, ipady=2)

        local_port_action_frame = tk.Frame(port_mgmt_lf, bg=BG_COLOR)
        local_port_action_frame.pack(fill=tk.X, pady=4, padx=5)

        tk.Label(local_port_action_frame, text="Port:", font=self.font_label, bg=BG_COLOR, fg=TEXT_COLOR).pack(side=tk.LEFT, padx=(5, 5))
        self.local_target_port_entry = tk.Entry(local_port_action_frame, width=8, font=self.font_entry, bg=ENTRY_BG, fg="white", insertbackground="white", relief=tk.FLAT)
        self.local_target_port_entry.pack(side=tk.LEFT, padx=5, ipady=3)

        self.btn_local_port_check = self.create_button(local_port_action_frame, "🔄 Portu Yoxla", "#2980B9", self.backend.check_local_port_status)
        self.btn_local_port_check.pack(side=tk.LEFT, padx=5, ipady=3)

        self.btn_local_port_toggle = self.create_button(local_port_action_frame, "🔓 Portu Aç", "#27AE60", self.backend.toggle_local_port)
        self.btn_local_port_toggle.pack(side=tk.LEFT, padx=5, ipady=3)

        self.lbl_local_port_status = tk.Label(local_port_action_frame, text="Vəziyyət: -- ⏳", font=self.font_label, bg=BG_COLOR, fg="#FFF")
        self.lbl_local_port_status.pack(side=tk.LEFT, padx=10)

        self.btn_local_port_list = self.create_button(local_port_action_frame, "📋 İcazəliləri Listələ", "#8E44AD", self.backend.local_list_ports)
        self.btn_local_port_list.pack(side=tk.LEFT, padx=10, ipady=3)

        # Monitor Frame
        self.local_monitor_frame = tk.Frame(self.tab_local, bg="#1a1a1a", highlightbackground=ACCENT_COLOR, highlightthickness=1)
        self.local_monitor_frame.pack(fill=tk.X, pady=(5, 10))
        
        self.lbl_local_cpu = tk.Label(self.local_monitor_frame, text="🟢 CPU: --", bg="#1a1a1a", fg=ACCENT_COLOR, font=("Consolas", 10, "bold"))
        self.lbl_local_cpu.pack(side=tk.LEFT, expand=True, pady=6)
        self.lbl_local_ram = tk.Label(self.local_monitor_frame, text="💾 RAM: -- / --", bg="#1a1a1a", fg="#00FF00", font=("Consolas", 10, "bold"))
        self.lbl_local_ram.pack(side=tk.LEFT, expand=True, pady=6)
        self.lbl_local_swap = tk.Label(self.local_monitor_frame, text="🔄 SWAP: -- / --", bg="#1a1a1a", fg="#FFCC00", font=("Consolas", 10, "bold"))
        self.lbl_local_swap.pack(side=tk.LEFT, expand=True, pady=6)

        # Actions
        btn_frame = tk.Frame(self.tab_local, bg=BG_COLOR)
        btn_frame.pack(fill=tk.X, pady=5)
        
        local_setup_lf = tk.LabelFrame(btn_frame, text=" 🛠️ Quraşdırma ", font=(self.font_label[0], 8, "bold"), bg=BG_COLOR, fg="#00FF00", bd=1, relief=tk.GROOVE)
        local_setup_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=2)
        
        self.btn_local_check = self.create_button(local_setup_lf, "🔐 İcazəni Yoxla", BTN_CHECK, self.backend.test_local_connection)
        self.btn_local_check.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_local_swap = self.create_button(local_setup_lf, "🔄 Swap Qur", "#E67E22", lambda: self.backend.run_local_task(self.backend.get_cmd_swap))
        self.btn_local_swap.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_local_git = self.create_button(local_setup_lf, "🐙 Git Qur", "#9B59B6", lambda: self.backend.run_local_task(self.backend.get_cmd_git))
        self.btn_local_git.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)

        local_docker_btn_frame = tk.Frame(local_setup_lf, bg=BG_COLOR)
        local_docker_btn_frame.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5)
        self.btn_local_docker = self.create_button(local_docker_btn_frame, "🐳 Docker Qur", BTN_PREP, lambda: self.backend.run_local_task(self.backend.get_cmd_docker))
        self.btn_local_docker.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=4)
        self.btn_local_docker_settings = self.create_button(local_docker_btn_frame, "⚙️", "#444", self.open_docker_settings)
        self.btn_local_docker_settings.pack(side=tk.LEFT, padx=(2, 0), ipady=4, ipadx=4)

        self.btn_local_panel = self.create_button(local_setup_lf, "🚀 Paneli Qur", BTN_PANEL, lambda: self.backend.run_local_task(self.backend.get_cmd_panel))
        self.btn_local_panel.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_local_all = self.create_button(local_setup_lf, "🌟 Tam Qur", BTN_ALL, lambda: self.backend.run_local_task(self.backend.get_cmd_all))
        self.btn_local_all.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)

        local_sys_lf = tk.LabelFrame(btn_frame, text=" 🖥️ Server & Servislər ", font=(self.font_label[0], 8, "bold"), bg=BG_COLOR, fg="#FFCC00", bd=1, relief=tk.GROOVE)
        local_sys_lf.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=2)

        self.btn_local_clean = self.create_button(local_sys_lf, "🗑️ Təmizlə", BTN_CLEAN, lambda: self.backend.run_local_task(self.backend.get_cmd_clean, confirm="Bütün sistemi təmizləmək istədiyinizə əminsiniz?"))
        self.btn_local_clean.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_local_portainer = self.create_button(local_sys_lf, "🐳 Portainer", "#00A2D3", lambda: self.backend.run_local_task(self.backend.get_cmd_portainer))
        self.btn_local_portainer.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)
        self.btn_local_token = self.create_button(local_sys_lf, "🔑 Token Yarat", "#8E44AD", lambda: self.backend.trigger_portainer_token(is_local=True))
        self.btn_local_token.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=2, pady=5, ipady=4)

        self.local_action_btns = [self.btn_local_swap, self.btn_local_git, self.btn_local_docker, self.btn_local_docker_settings, self.btn_local_panel, self.btn_local_all, self.btn_local_clean, self.btn_local_portainer, self.btn_local_token, self.btn_local_port_check, self.btn_local_port_toggle, self.btn_local_port_list]
        self.toggle_local_buttons(tk.DISABLED)

        console_header = tk.Frame(self.tab_local, bg=BG_COLOR)
        console_header.pack(fill=tk.X, pady=(10, 0))
        
        tk.Label(console_header, text="Yerli PC Çıxışı:", font=self.font_label, bg=BG_COLOR, fg=ACCENT_COLOR).pack(side=tk.LEFT)
        
        self.create_button(console_header, "📄 Kopyala", "#444", lambda: self.backend.copy_console(self.console_local)).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "🗑️ Konsolu Təmizlə", "#C0392B", lambda: self.console_local.delete("1.0", tk.END)).pack(side=tk.RIGHT, padx=2)
        self.create_button(console_header, "🔍 -", "#444", self.zoom_out_local).pack(side=tk.RIGHT, padx=2, ipadx=4)
        self.create_button(console_header, "🔍 +", "#444", self.zoom_in_local).pack(side=tk.RIGHT, padx=2, ipadx=4)

        self.console_local = scrolledtext.ScrolledText(self.tab_local, height=9, bg="#0A0A0A", fg="#00FF00", font=self.font_console, relief=tk.FLAT, padx=5, pady=5)
        self.console_local.pack(fill=tk.BOTH, expand=True, pady=5)

    def browse_key(self):
        file_path = filedialog.askopenfilename(title="SSH Açarını Seçin")
        if file_path:
            self.key_entry.delete(0, tk.END)
            self.key_entry.insert(0, file_path)

    def open_docker_settings(self):
        win = tk.Toplevel(self.root)
        win.title("Docker Quraşdırma Ayarları")
        win.geometry("320x240")
        win.configure(bg=BG_COLOR)
        win.grab_set()
        
        tk.Label(win, text="Quraşdırılacaq Komponentlər:", font=self.font_label, bg=BG_COLOR, fg=ACCENT_COLOR).pack(anchor=tk.W, padx=20, pady=10)
        
        tk.Checkbutton(win, text="Docker Engine", variable=self.docker_engine_var, bg=BG_COLOR, fg=TEXT_COLOR, selectcolor=BG_COLOR, font=self.font_entry, activebackground=BG_COLOR, activeforeground="white").pack(anchor=tk.W, padx=40, pady=2)
        tk.Checkbutton(win, text="Docker CLI", variable=self.docker_cli_var, bg=BG_COLOR, fg=TEXT_COLOR, selectcolor=BG_COLOR, font=self.font_entry, activebackground=BG_COLOR, activeforeground="white").pack(anchor=tk.W, padx=40, pady=2)
        tk.Checkbutton(win, text="Docker Buildx Plugin", variable=self.docker_buildx_var, bg=BG_COLOR, fg=TEXT_COLOR, selectcolor=BG_COLOR, font=self.font_entry, activebackground=BG_COLOR, activeforeground="white").pack(anchor=tk.W, padx=40, pady=2)
        tk.Checkbutton(win, text="Docker Compose Plugin", variable=self.docker_compose_var, bg=BG_COLOR, fg=TEXT_COLOR, selectcolor=BG_COLOR, font=self.font_entry, activebackground=BG_COLOR, activeforeground="white").pack(anchor=tk.W, padx=40, pady=2)
        tk.Checkbutton(win, text="Containerd Engine", variable=self.docker_containerd_var, bg=BG_COLOR, fg=TEXT_COLOR, selectcolor=BG_COLOR, font=self.font_entry, activebackground=BG_COLOR, activeforeground="white").pack(anchor=tk.W, padx=40, pady=2)
        
        self.create_button(win, "Yadda Saxla", "#27AE60", win.destroy).pack(pady=15, ipady=3, ipadx=10)

    def toggle_remote_buttons(self, state):
        for btn in self.remote_action_btns:
            btn.config(state=state)
            if state == tk.NORMAL:
                if btn == self.btn_swap: btn.config(bg="#E67E22", fg="white")
                elif btn == self.btn_git: btn.config(bg="#9B59B6", fg="white")
                elif btn == self.btn_docker: btn.config(bg=BTN_PREP, fg="white")
                elif btn == self.btn_panel: btn.config(bg=BTN_PANEL, fg="white")
                elif btn == self.btn_all: btn.config(bg=BTN_ALL, fg="white")
                elif btn == self.btn_reboot: btn.config(bg=BTN_REBOOT, fg="black")
                elif btn == self.btn_clean: btn.config(bg=BTN_CLEAN, fg="white")
                elif btn == self.btn_portainer: btn.config(bg="#00A2D3", fg="white")
                elif btn == getattr(self, 'btn_token', None): btn.config(bg="#8E44AD", fg="white")
                elif btn == self.btn_port_toggle: btn.config(bg="#27AE60", fg="white")

    def toggle_local_buttons(self, state):
        for btn in self.local_action_btns:
            btn.config(state=state)
            if state == tk.NORMAL:
                if btn == self.btn_local_swap: btn.config(bg="#E67E22", fg="white")
                elif btn == self.btn_local_git: btn.config(bg="#9B59B6", fg="white")
                elif btn == self.btn_local_docker: btn.config(bg=BTN_PREP, fg="white")
                elif btn == self.btn_local_panel: btn.config(bg=BTN_PANEL, fg="white")
                elif btn == self.btn_local_all: btn.config(bg=BTN_ALL, fg="white")
                elif btn == self.btn_local_clean: btn.config(bg=BTN_CLEAN, fg="white")
                elif btn == self.btn_local_portainer: btn.config(bg="#00A2D3", fg="white")
                elif btn == getattr(self, 'btn_local_token', None): btn.config(bg="#8E44AD", fg="white")
                elif btn == self.btn_local_port_toggle: btn.config(bg="#27AE60", fg="white")
                elif btn == self.btn_local_port_list: btn.config(bg="#8E44AD", fg="white")

    def zoom_in_remote(self):
        self.backend.zoom_text(self.console_remote, 1)

    def zoom_out_remote(self):
        self.backend.zoom_text(self.console_remote, -1)

    def zoom_in_local(self):
        self.backend.zoom_text(self.console_local, 1)

    def zoom_out_local(self):
        self.backend.zoom_text(self.console_local, -1)
