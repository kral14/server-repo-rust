import os
import json
import subprocess
import threading
import time
import tkinter as tk
from tkinter import messagebox, scrolledtext
import urllib.request
import urllib.error

# Import GUI and colors
from installer_gui import RemoteInstallerGUI, BTN_CHECK, BTN_PREP, BTN_PANEL, BTN_ALL, BTN_REBOOT, BTN_CLEAN, ACCENT_COLOR, ENTRY_BG

class RemoteInstallerLogic:
    def __init__(self):
        self.gui = None  # GUI işə düşəndə özünü bura bağlayacaq
        self.monitoring_active = False

    def center_window(self, size_str):
        try:
            size = size_str.split('+')[0] if '+' in size_str else size_str
            w, h = map(int, size.split('x'))
            ws = self.gui.root.winfo_screenwidth()
            hs = self.gui.root.winfo_screenheight()
            x = (ws / 2) - (w / 2)
            y = (hs / 2) - (h / 2)
            self.gui.root.geometry(f"{w}x{h}+{int(x)}+{int(y)}")
        except:
            self.gui.root.geometry(size_str)

    def load_config(self):
        if not self.gui: return
        try:
            if os.path.exists("config.json"):
                with open("config.json", "r") as f:
                    data = json.load(f)
                    self.gui.ip_entry.insert(0, data.get("ip", ""))
                    self.gui.user_entry.delete(0, tk.END)
                    self.gui.user_entry.insert(0, data.get("user", "ubuntu"))
                    self.gui.key_entry.insert(0, data.get("key", ""))
                    
                    swap_val = data.get("swap", "2")
                    self.gui.swap_entry.delete(0, tk.END)
                    self.gui.swap_entry.insert(0, swap_val)
                    self.gui.local_swap_entry.delete(0, tk.END)
                    self.gui.local_swap_entry.insert(0, swap_val)
                    
                    panel_val = data.get("panel_port", "3000")
                    self.gui.panel_port_entry.insert(0, panel_val)
                    self.gui.local_panel_port_entry.insert(0, panel_val)
                    
                    port_val = data.get("portainer_port", "9000")
                    self.gui.portainer_port_entry.insert(0, port_val)
                    self.gui.local_portainer_port_entry.insert(0, port_val)
                    
                    geom = data.get("geometry", "850x780")
                    self.center_window(geom)
            else:
                self.gui.user_entry.insert(0, "ubuntu")
                self.gui.swap_entry.insert(0, "2")
                self.gui.local_swap_entry.insert(0, "2")
                self.gui.panel_port_entry.insert(0, "3000")
                self.gui.local_panel_port_entry.insert(0, "3000")
                self.gui.portainer_port_entry.insert(0, "9000")
                self.gui.local_portainer_port_entry.insert(0, "9000")
                self.center_window("850x780")
        except:
            try: self.center_window("850x780")
            except: pass

    def save_window_geometry(self):
        if self.gui and self.gui.root.state() == "normal":
            self.save_config()

    def save_config(self):
        if not self.gui: return
        try:
            active_tab = self.gui.notebook.index(self.gui.notebook.select())
            if active_tab == 0:
                swap_val = self.gui.swap_entry.get().strip()
                panel_val = self.gui.panel_port_entry.get().strip()
                portainer_val = self.gui.portainer_port_entry.get().strip()
            else:
                swap_val = self.gui.local_swap_entry.get().strip()
                panel_val = self.gui.local_panel_port_entry.get().strip()
                portainer_val = self.gui.local_portainer_port_entry.get().strip()
                
            geom = self.gui.root.geometry()
            
            data = {
                "ip": self.gui.ip_entry.get().strip(),
                "user": self.gui.user_entry.get().strip(),
                "key": self.gui.key_entry.get().strip(),
                "swap": swap_val,
                "panel_port": panel_val,
                "portainer_port": portainer_val,
                "geometry": geom
            }
            with open("config.json", "w") as f:
                json.dump(data, f)
        except: pass

    def copy_console(self, console_widget):
        try:
            # Əgər istifadəçi siçanla hər hansı hissəni seçibsə, yalnız onu kopyalayırıq
            text = console_widget.get("sel.first", "sel.last")
        except tk.TclError:
            # Seçim yoxdursa, bütün konsol mətnini kopyalayırıq
            text = console_widget.get("1.0", tk.END).strip()
            
        if text:
            self.gui.root.clipboard_clear()
            self.gui.root.clipboard_append(text)
            messagebox.showinfo("Kopyalandı", "Mətn panoya kopyalandı!")

    def clear_remote_console(self):
        self.gui.console_remote.delete("1.0", tk.END)

    def log_remote(self, text):
        if self.gui:
            self.gui.console_remote.insert(tk.END, text + "\n")
            self.gui.console_remote.see(tk.END)

    def log_local(self, text):
        if self.gui:
            self.gui.console_local.insert(tk.END, text + "\n")
            self.gui.console_local.see(tk.END)

    def zoom_text(self, text_widget, delta):
        try:
            current_font = text_widget.cget("font")
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
        except: pass

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
        if not self.gui: return
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        
        if not ip or not user or not key_path:
            if not auto: messagebox.showwarning("Xəta", "Bütün xanaları doldurun!")
            return

        self.save_config()
        self.log_remote(f"\n--- Yoxlanılır: {user}@{ip} ---")
        self.gui.btn_check.config(state=tk.DISABLED, text="Gözləyin...")
        
        def task():
            self.fix_key_permissions(key_path)
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", "echo 'Bağlantı Uğurludur!'"]
            try:
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace', creationflags=creationflags)
                if proc.returncode == 0:
                    self.log_remote("✅ QOŞULMA UĞURLUDUR!")
                    self.gui.root.after(0, lambda: self.gui.toggle_remote_buttons(tk.NORMAL))
                    if not auto: messagebox.showinfo("Uğurlu", "Serverə qoşulma uğurludur!")
                    self.gui.monitor_frame.pack(fill=tk.X, pady=(0, 10))
                    self.start_monitoring()
                    self.gui.root.after(100, self.check_remote_fw_status)
                    self.gui.root.after(150, lambda: self.check_remote_port_status(show_warning=False))
                else:
                    self.log_remote(f"❌ XƏTA:\n{proc.stdout}")
            except Exception as e:
                self.log_remote(f"❌ SİSTEM XƏTASI: {e}")
            self.gui.root.after(0, lambda: self.gui.btn_check.config(state=tk.NORMAL, text="🔗 Yoxla", bg=BTN_CHECK))
        
        threading.Thread(target=task, daemon=True).start()

    def start_monitoring(self):
        if self.monitoring_active: return
        self.monitoring_active = True
        
        def monitor_loop():
            while self.monitoring_active:
                ip = self.gui.ip_entry.get().strip()
                user = self.gui.user_entry.get().strip()
                key_path = self.gui.key_entry.get().strip()
                if not ip or not user or not key_path: break
                
                # Fetch Stats
                cmd = "top -bn1 | grep 'Cpu(s)' | awk '{print $2}'; free -m | awk 'NR==2{printf \"%.2fGB/%.2fGB\", $3/1024,$2/1024}'; free -m | awk 'NR==3{printf \"%.2fGB/%.2fGB\", $3/1024,$2/1024}'"
                ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=creationflags)
                
                if proc.returncode == 0:
                    lines = proc.stdout.strip().split('\n')
                    if len(lines) >= 3:
                        cpu = f"🟢 CPU: {lines[0]}%"
                        ram = f"💾 RAM: {lines[1]}"
                        swap = f"🔄 SWAP: {lines[2]}"
                        self.gui.root.after(0, lambda: self.gui.lbl_cpu.config(text=cpu))
                        self.gui.root.after(0, lambda: self.gui.lbl_ram.config(text=ram))
                        self.gui.root.after(0, lambda: self.gui.lbl_swap.config(text=swap))
                time.sleep(5)
                
        threading.Thread(target=monitor_loop, daemon=True).start()

    def check_remote_fw_status(self):
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        if not ip or not user or not key_path: return

        self.gui.lbl_fw_status.config(text="Firewall: Yoxlanılır... ⏳", fg="#FFF")

        def task():
            cmd = "sudo ufw status | grep -q 'Status: active' && (sudo ufw status | grep -v '22/tcp' | grep -q 'ALLOW') && echo 'ACTIVE' || echo 'INACTIVE'"
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=creationflags)
            
            res = proc.stdout.strip() if proc.returncode == 0 else "INACTIVE"
            if "ACTIVE" in res:
                self.gui.root.after(0, lambda: self.gui.lbl_fw_status.config(text="Firewall: Aktiv 🟢", fg="#2ECC71"))
                self.gui.root.after(0, lambda: self.gui.btn_fw_toggle.config(text="⚡ Bütün Portları Bağla", bg="#D35400"))
            else:
                self.gui.root.after(0, lambda: self.gui.lbl_fw_status.config(text="Firewall: Deaktiv 🔴", fg="#E74C3C"))
                self.gui.root.after(0, lambda: self.gui.btn_fw_toggle.config(text="⚡ İcazəli Portları Aç", bg="#27AE60"))
        
        threading.Thread(target=task, daemon=True).start()

    def toggle_remote_fw(self):
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        if not ip or not user or not key_path: return

        current_fw = self.gui.lbl_fw_status.cget("text")
        panel_port = self.gui.panel_port_entry.get().strip() or "3000"
        portainer_port = self.gui.portainer_port_entry.get().strip() or "9000"
        
        if "Aktiv" in current_fw:
            cmd = "sudo ufw reset --force && sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw allow 22/tcp && sudo ufw --force enable"
            msg = "⚡ Uzaq serverdə bütün portlar bağlanır (SSH xaric)..."
        else:
            cmd = f"sudo ufw allow 22/tcp 2>/dev/null || true; sudo ufw allow {panel_port}/tcp 2>/dev/null || true; sudo ufw allow {portainer_port}/tcp 2>/dev/null || true; sudo ufw --force enable"
            msg = "⚡ Uzaq serverdə standart icazəli portlar açılır..."

        self.log_remote(f"\n--- {msg} ---")

        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=creationflags)
            if proc.returncode == 0:
                self.log_remote("✅ Firewall statusu uğurla yeniləndi!")
                self.gui.root.after(500, self.check_remote_fw_status)
            else:
                self.log_remote(f"❌ Firewall xətası: {proc.stderr}")
        
        threading.Thread(target=task, daemon=True).start()

    def check_remote_port_status(self, show_warning=True):
        port = self.gui.target_port_entry.get().strip()
        if not port.isdigit():
            if show_warning:
                messagebox.showwarning("Xəta", "Zəhmət olmasa düzgün port daxil edin!")
            return
            
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        
        self.gui.lbl_port_status.config(text="Yoxlanılır... ⏳", fg="#FFF")
        
        def task():
            cmd = f"sudo LC_ALL=C ufw status | grep -q 'Status: active' && sudo LC_ALL=C ufw status | grep -w '{port}/tcp' && echo 'OPEN' || echo 'CLOSED'"
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=creationflags)
            
            res = proc.stdout.strip() if proc.returncode == 0 else "CLOSED"
            if "OPEN" in res:
                self.gui.root.after(0, lambda: self.gui.lbl_port_status.config(text="Açıq 🟢", fg="#2ECC71"))
                self.gui.root.after(0, lambda: self.gui.btn_port_toggle.config(text="🔒 Portu Bağla", bg="#C0392B"))
            else:
                self.gui.root.after(0, lambda: self.gui.lbl_port_status.config(text="Bağlı 🔴", fg="#E74C3C"))
                self.gui.root.after(0, lambda: self.gui.btn_port_toggle.config(text="🔓 Portu Aç", bg="#27AE60"))
        
        threading.Thread(target=task, daemon=True).start()

    def toggle_remote_port(self):
        port = self.gui.target_port_entry.get().strip()
        if not port.isdigit(): return
        
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        
        current_status = self.gui.lbl_port_status.cget("text")
        
        if "Açıq" in current_status:
            action_cmd = f"sudo ufw delete allow {port}/tcp 2>/dev/null || true; sudo iptables -D INPUT -p tcp --dport {port} -j ACCEPT 2>/dev/null || true"
            msg_success = f"✅ Port {port} uğurla bağlandı!"
        else:
            action_cmd = f"sudo ufw allow {port}/tcp 2>/dev/null || true; sudo iptables -I INPUT -p tcp --dport {port} -j ACCEPT 2>/dev/null || true"
            msg_success = f"✅ Port {port} uğurla açıldı!"
            
        self.log_remote(f"\n--- Port {port} üzərində əməliyyat aparılır... ---")
        
        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", action_cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace', creationflags=creationflags)
            if proc.returncode == 0:
                self.log_remote(msg_success)
                self.gui.root.after(0, self.check_remote_port_status)
            else:
                self.log_remote(f"❌ Xəta baş verdi: {proc.stderr}")
        
        threading.Thread(target=task, daemon=True).start()

    def remote_list_ports(self):
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        if not ip or not user or not key_path: return

        self.log_remote("\n--- Uzaq Server Açıq / İcazəli Portları ---")
        
        cmd = """
        echo '=== AÇIQ TCP PORTLARI ==='
        sudo ss -tlnp | awk 'NR>1 {
            split($4, a, ":"); 
            port=a[length(a)]; 
            split($6, b, "\\""); 
            proc=b[2];
            if(proc=="") proc="Bilinməyən";
            print "-> Port: " port " [" proc "]"
        }' | sort -V
        
        echo ''
        echo '=== UFW İCAZƏLİ PORTLAR ==='
        sudo ufw status numbered
        """
        
        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace', creationflags=creationflags)
            self.log_remote(proc.stdout)
            
        threading.Thread(target=task, daemon=True).start()

    def refresh_remote_logs(self):
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        if not ip or not user or not key_path: return
        
        self.log_remote("\n--- Son 15 deployment logu yenilənir... ---")
        def task():
            cmd = "sudo docker logs --tail 15 masterdeploy 2>/dev/null || echo 'masterdeploy adında docker konteyneri tapılmadı!'"
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", cmd]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace', creationflags=creationflags)
            if proc.returncode == 0:
                self.log_remote(proc.stdout)
            else:
                self.log_remote("❌ Loglar yenilənə bilmədi: Serverə qoşulmaq olmur.")
        threading.Thread(target=task, daemon=True).start()

    def remote_reboot(self):
        if not messagebox.askyesno("Təsdiq", "Serveri yenidən başlatmaq istədiyinizə əminsiniz?"): return
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        self.log_remote(f"\n--- SERVER RESTART EDİLİR ({ip}) ---")
        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", key_path, f"{user}@{ip}", "sudo reboot"]
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=creationflags)
        threading.Thread(target=task, daemon=True).start()
        self.log_remote("Serverə restart əmri verildi! 1-2 dəqiqə əlaqə kəsiləcək.")

    # ==========================================
    # LOCAL TAB (LOCAL PC BACKEND)
    # ==========================================
    def test_local_connection(self):
        if os.name == 'nt':
            messagebox.showerror("Xəta", "Bu rejim yalnız Linux (Ubuntu/Debian) əməliyyat sistemi üçündür!\nWindows-da quraşdırma aparıla bilməz.")
            self.log_local("❌ Yerli Quraşdırma yalnız Linux üçündür!")
            return
            
        sudo_pass = self.gui.local_pass_entry.get().strip()
        if not sudo_pass:
            messagebox.showwarning("Xəta", "Sudo (Administrator) parolunu daxil edin!")
            return

        self.log_local("\n--- Yerli Sudo İcazəsi Yoxlanılır ---")
        self.gui.btn_local_check.config(state=tk.DISABLED, text="Gözləyin...")
        
        def task():
            cmd = ["sudo", "-S", "echo", "Sudo isleyen veziyyetdedir"]
            try:
                proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                out, err = proc.communicate(input=sudo_pass + "\n")
                if proc.returncode == 0:
                    self.log_local("✅ SUDO İCAZƏSİ TƏSDİQLƏNDİ!")
                    self.gui.root.after(0, lambda: self.gui.toggle_local_buttons(tk.NORMAL))
                    if "Uğurlu" not in str(messagebox):
                        self.gui.root.after(0, lambda: messagebox.showinfo("Uğurlu", "Administrator icazəsi qəbul edildi!"))
                    self.gui.root.after(100, self.check_local_fw_status)
                    self.gui.root.after(150, lambda: self.check_local_port_status(show_warning=False))
                else:
                    self.log_local(f"❌ XƏTA (Böyük ehtimal parol səhvdir):\n{err}")
            except Exception as e:
                self.log_local(f"❌ SİSTEM XƏTASI: {e}")
            self.gui.root.after(0, lambda: self.gui.btn_local_check.config(state=tk.NORMAL, text="🔐 İcazəni Yoxla", bg=BTN_CHECK))

        threading.Thread(target=task, daemon=True).start()

    def check_local_fw_status(self):
        sudo_pass = self.gui.local_pass_entry.get().strip()
        if not sudo_pass: return

        self.gui.lbl_local_fw_status.config(text="Firewall: Yoxlanılır... ⏳", fg="#FFF")

        def task():
            cmd = "sudo -S LC_ALL=C ufw status"
            try:
                proc = subprocess.Popen(["bash", "-c", cmd], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                out, err = proc.communicate(input=sudo_pass + "\n")
                
                self.log_local("\n[DIAGNOSTICS] Lokal UFW statusu yoxlanılır...")
                
                has_allowed_ports = False
                for line in out.splitlines():
                    if "ALLOW" in line and "22/tcp" not in line:
                        has_allowed_ports = True
                        break
                
                if "Status: active" in out and has_allowed_ports:
                    self.log_local("[DIAGNOSTICS] Firewall statusu: AKTİV (Portlar açıq)")
                    self.gui.root.after(0, lambda: self.gui.lbl_local_fw_status.config(text="Firewall: Portlar Açıq 🟢", fg="#2ECC71"))
                    self.gui.root.after(0, lambda: self.gui.btn_local_fw_toggle.config(text="🔒 Bütün Portları Bağla", bg="#C0392B"))
                else:
                    self.log_local("[DIAGNOSTICS] Firewall statusu: DEAKTİV (Bütün Portlar Bağlı)")
                    self.gui.root.after(0, lambda: self.gui.lbl_local_fw_status.config(text="Firewall: Portlar Bağlı 🔴", fg="#E74C3C"))
                    self.gui.root.after(0, lambda: self.gui.btn_local_fw_toggle.config(text="🔓 Portları Aç", bg="#27AE60"))
            except Exception as e:
                self.log_local(f"[DIAGNOSTICS] Sistem xətası: {e}")
        
        threading.Thread(target=task, daemon=True).start()

    def toggle_local_fw(self):
        sudo_pass = self.gui.local_pass_entry.get().strip()
        if not sudo_pass:
            messagebox.showwarning("Xəta", "Sudo parolunu daxil edin!")
            return

        current_fw = self.gui.lbl_local_fw_status.cget("text")
        panel_port = self.gui.local_panel_port_entry.get().strip() or "3000"
        portainer_port = self.gui.local_portainer_port_entry.get().strip() or "9000"
        
        if "Portlar Açıq" in current_fw:
            bash_cmds = (
                "ufw --force reset; "
                "ufw default deny incoming; "
                "ufw default allow outgoing; "
                "ufw allow 22/tcp; "
                "ufw --force enable; "
                f"iptables -I DOCKER-USER -p tcp --dport {panel_port} -j DROP 2>/dev/null || true; "
                f"iptables -I DOCKER-USER -p tcp --dport {portainer_port} -j DROP 2>/dev/null || true; "
                f"iptables -I INPUT -p tcp --dport {panel_port} -j DROP 2>/dev/null || true; "
                f"iptables -I INPUT -p tcp --dport {portainer_port} -j DROP 2>/dev/null || true; "
                f"iptables -I OUTPUT -p tcp --dport {panel_port} -j DROP 2>/dev/null || true; "
                f"iptables -I OUTPUT -p tcp --dport {portainer_port} -j DROP 2>/dev/null || true"
            )
            cmd = f"sudo -S bash -c '{bash_cmds}'"
            msg = f"🔒 Lokal firewall: bütün portlar bağlanır (yalnız SSH 22 açıq qalır, {panel_port} və {portainer_port} bloklanır)..."
        else:
            bash_cmds = (
                f"ufw allow 22/tcp 2>/dev/null || true; "
                f"ufw allow {panel_port}/tcp 2>/dev/null || true; "
                f"ufw allow {portainer_port}/tcp 2>/dev/null || true; "
                f"ufw --force enable; "
                f"iptables -D DOCKER-USER -p tcp --dport {panel_port} -j DROP 2>/dev/null || true; "
                f"iptables -D DOCKER-USER -p tcp --dport {portainer_port} -j DROP 2>/dev/null || true; "
                f"iptables -D INPUT -p tcp --dport {panel_port} -j DROP 2>/dev/null || true; "
                f"iptables -D INPUT -p tcp --dport {portainer_port} -j DROP 2>/dev/null || true; "
                f"iptables -D OUTPUT -p tcp --dport {panel_port} -j DROP 2>/dev/null || true; "
                f"iptables -D OUTPUT -p tcp --dport {portainer_port} -j DROP 2>/dev/null || true"
            )
            cmd = f"sudo -S bash -c '{bash_cmds}'"
            msg = f"🔓 Lokal firewall: portlar açılır (22, {panel_port}, {portainer_port})..."

        self.log_local(f"\n--- {msg} ---")

        def task():
            try:
                proc = subprocess.Popen(
                    ["bash", "-c", cmd],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )
                out, err = proc.communicate(input=sudo_pass + "\n")
                err_clean = "\n".join(
                    l for l in err.splitlines()
                    if "[sudo]" not in l and "password" not in l.lower()
                )
                if proc.returncode == 0:
                    self.log_local("✅ Lokal firewall statusu uğurla yeniləndi!")
                else:
                    self.log_local(f"⚠️ Xəbərdarlıq: {err_clean.strip() or out.strip()}")
                self.gui.root.after(500, self.check_local_fw_status)
            except Exception as e:
                self.log_local(f"❌ Xəta: {e}")

        threading.Thread(target=task, daemon=True).start()

    def check_local_port_status(self, show_warning=True):
        port = self.gui.local_target_port_entry.get().strip()
        if not port.isdigit():
            if show_warning:
                messagebox.showwarning("Xəta", "Zəhmət olmasa daxil edin!")
            return
            
        sudo_pass = self.gui.local_pass_entry.get().strip()
        self.gui.lbl_local_port_status.config(text="Yoxlanılır... ⏳", fg="#FFF")
        
        def task():
            cmd = (
                f"sudo -S LC_ALL=C ufw status | grep -w '{port}/tcp' && "
                f"(sudo -S iptables -L DOCKER-USER -n 2>/dev/null | grep -q 'DROP.*dpt:{port}' || "
                f"sudo -S iptables -L OUTPUT -n 2>/dev/null | grep -q 'DROP.*dpt:{port}') && "
                f"echo 'BLOCKED' || echo 'OPEN_OR_DENY'"
            )
            try:
                proc = subprocess.Popen(["bash", "-c", cmd], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                out, _ = proc.communicate(input=sudo_pass + "\n" + sudo_pass + "\n" + sudo_pass + "\n")
                
                if "ALLOW" in out and "BLOCKED" not in out:
                    self.gui.root.after(0, lambda: self.gui.lbl_local_port_status.config(text="Açıq 🟢", fg="#2ECC71"))
                    self.gui.root.after(0, lambda: self.gui.btn_local_port_toggle.config(text="🔒 Portu Bağla", bg="#C0392B"))
                else:
                    self.gui.root.after(0, lambda: self.gui.lbl_local_port_status.config(text="Bağlı 🔴", fg="#E74C3C"))
                    self.gui.root.after(0, lambda: self.gui.btn_local_port_toggle.config(text="🔓 Portu Aç", bg="#27AE60"))
            except Exception as e:
                self.gui.root.after(0, lambda: self.gui.lbl_local_port_status.config(text="Xəta ⚠️", fg="#FFF"))
        
        threading.Thread(target=task, daemon=True).start()

    def toggle_local_port(self):
        port = self.gui.local_target_port_entry.get().strip()
        if not port.isdigit(): return
        
        sudo_pass = self.gui.local_pass_entry.get().strip()
        current_status = self.gui.lbl_local_port_status.cget("text")
        
        if "Açıq" in current_status:
            bash_cmds = (
                f"ufw delete allow {port}/tcp 2>/dev/null || true; "
                f"iptables -D INPUT -p tcp --dport {port} -j ACCEPT 2>/dev/null || true; "
                f"iptables -I DOCKER-USER -p tcp --dport {port} -j DROP 2>/dev/null || true; "
                f"iptables -I INPUT -p tcp --dport {port} -j DROP 2>/dev/null || true; "
                f"iptables -I OUTPUT -p tcp --dport {port} -j DROP 2>/dev/null || true"
            )
            cmd = f"sudo -S bash -c '{bash_cmds}'"
            msg_success = f"✅ Lokal Port {port} uğurla bağlandı (Docker daxil)!"
        else:
            bash_cmds = (
                f"ufw allow {port}/tcp 2>/dev/null || true; "
                f"iptables -I INPUT -p tcp --dport {port} -j ACCEPT 2>/dev/null || true; "
                f"iptables -D DOCKER-USER -p tcp --dport {port} -j DROP 2>/dev/null || true; "
                f"iptables -D INPUT -p tcp --dport {port} -j DROP 2>/dev/null || true; "
                f"iptables -D OUTPUT -p tcp --dport {port} -j DROP 2>/dev/null || true"
            )
            cmd = f"sudo -S bash -c '{bash_cmds}'"
            msg_success = f"✅ Lokal Port {port} uğurla açıldı!"
            
        self.log_local(f"\n--- Lokal Port {port} üzərində əməliyyat aparılır... ---")
        
        def task():
            try:
                proc = subprocess.Popen(["bash", "-c", cmd], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                _, _ = proc.communicate(input=sudo_pass + "\n")
                self.log_local(msg_success)
                self.gui.root.after(0, self.check_local_port_status)
            except Exception as e:
                self.log_local(f"❌ Xəta: {e}")
        
        threading.Thread(target=task, daemon=True).start()

    def local_list_ports(self):
        sudo_pass = self.gui.local_pass_entry.get().strip()
        if not sudo_pass:
            messagebox.showwarning("Xəta", "Sudo parolunu daxil edin!")
            return
            
        self.log_local("\n--- Lokal PC Açıq / İcazəli Portları ---")
        cmd = """
        echo '=== AÇIQ TCP PORTLARI ==='
        sudo -S ss -tlnp | awk 'NR>1 {
            split($4, a, ":"); 
            port=a[length(a)]; 
            split($6, b, "\\""); 
            proc=b[2];
            if(proc=="") proc="Bilinməyən";
            print "-> Port: " port " [" proc "]"
        }' | sort -V
        
        echo ''
        echo '=== UFW İCAZƏLİ PORTLAR ==='
        sudo -S ufw status numbered
        """
        def task():
            try:
                proc = subprocess.Popen(["bash", "-c", cmd], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                out, _ = proc.communicate(input=sudo_pass + "\n")
                clean_out = "\n".join([line for line in out.splitlines() if "[sudo] password" not in line])
                self.log_local(clean_out)
            except Exception as e:
                self.log_local(f"❌ Xəta: {e}")
        threading.Thread(target=task, daemon=True).start()

    def run_local_task(self, cmd_func, confirm=None):
        if os.name == 'nt':
            messagebox.showerror("Xəta", "Yerli quraşdırma yalnız Linux-da işləyir!")
            return
            
        if confirm and not messagebox.askyesno("Təsdiq", confirm):
            return
            
        sudo_pass = self.gui.local_pass_entry.get().strip()
        swap_gb = self.gui.local_swap_entry.get().strip()
        if not swap_gb.isdigit(): swap_gb = "2"
        panel_port = self.gui.local_panel_port_entry.get().strip() or "3000"
        portainer_port = self.gui.local_portainer_port_entry.get().strip() or "9000"
        
        self.save_config()
        cmd = cmd_func(swap_gb, panel_port, portainer_port)
        
        self.log_local("\n--- Yerli Quraşdırma Başladı ---")
        self.gui.toggle_local_buttons(tk.DISABLED)
        
        def task():
            try:
                proc = subprocess.Popen(["bash", "-c", cmd], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, universal_newlines=True)
                
                # Sudo parolunu avtomatik ötürürük
                proc.stdin.write(sudo_pass + "\n")
                proc.stdin.flush()
                
                while True:
                    line = proc.stdout.readline()
                    if not line: break
                    clean_line = line.strip()
                    if "[sudo] password" not in clean_line:
                        self.log_local(line.rstrip())
                        
                proc.stdout.close()
                proc.wait()
                if proc.returncode == 0:
                    self.log_local("✅ YERLİ ƏMƏLİYYAT UĞURLA BİTDİ!")
                else:
                    self.log_local(f"❌ Əməliyyat xəta ilə bitdi: {proc.returncode}")
            except Exception as e:
                self.log_local(f"❌ Sistem xətası: {e}")
            self.gui.root.after(0, lambda: self.gui.toggle_local_buttons(tk.NORMAL))
            self.gui.root.after(200, self.check_local_fw_status)
            
        threading.Thread(target=task, daemon=True).start()

    # ==========================================
    # COMMAND GENERATORS
    # ==========================================
    def get_cmd_swap(self, swap_gb, panel_p, port_p):
        swap_mb = int(swap_gb) * 1024
        cmd = """
echo 'Swap Sazlanır...';
if grep -q '/swapfile' /proc/swaps; then
    echo 'Mövcud Swap söndürülür...';
    sudo swapoff /swapfile;
    sudo rm -f /swapfile;
fi;
sudo fallocate -l SWAP_GBG /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=SWAP_MB;
sudo chmod 600 /swapfile;
sudo mkswap /swapfile;
sudo swapon /swapfile;
grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab;
sudo sysctl vm.swappiness=10;
echo '✅ Swap uğurla quruldu!';
"""
        return cmd.replace("SWAP_GB", str(swap_gb)).replace("SWAP_MB", str(swap_mb))

    def get_cmd_git(self, swap_gb, panel_p, port_p):
        return """
echo 'Git yoxlanılır...';
if ! command -v git > /dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y git;
    echo '✅ Git quraşdırıldı!';
else
    echo '✅ Git artıq mövcuddur: '$(git --version);
fi;
"""

    def get_cmd_docker(self, swap_gb, panel_p, port_p):
        pkgs = []
        if self.gui.docker_engine_var.get(): pkgs.append("docker-ce")
        if self.gui.docker_cli_var.get(): pkgs.append("docker-ce-cli")
        if self.gui.docker_containerd_var.get(): pkgs.append("containerd.io")
        if self.gui.docker_buildx_var.get(): pkgs.append("docker-buildx-plugin")
        if self.gui.docker_compose_var.get(): pkgs.append("docker-compose-plugin")
        
        pkg_str = " ".join(pkgs)
        
        return f"""
echo 'Docker yoxlanılır...';
sudo apt-get update;
sudo apt-get install -y ca-certificates curl gnupg lsb-release;
sudo mkdir -p /etc/apt/keyrings;
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -y -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true;
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null;
sudo apt-get update;
sudo apt-get install -y {pkg_str};
sudo systemctl enable docker; sudo systemctl start docker;
echo '✅ Docker komponentləri uğurla quraşdırıldı!';
"""

    def get_cmd_panel(self, swap_gb, panel_p, port_p):
        return f"""
echo 'MasterDeploy Qurulur...';
sudo rm -rf server-repo-rust;
git clone https://github.com/kral14/server-repo-rust.git;
cd server-repo-rust/MasterDeploy-rust;
sudo ufw default deny incoming 2>/dev/null || true;
sudo ufw default allow outgoing 2>/dev/null || true;
sudo ufw allow 22/tcp 2>/dev/null || true;
sudo ufw allow {panel_p}/tcp 2>/dev/null || true;
sudo ufw --force enable 2>/dev/null || true;
sudo docker stop masterdeploy 2>/dev/null || true;
sudo docker rm masterdeploy 2>/dev/null || true;
sudo docker build -t masterdeploy .;
sudo docker run -d --name masterdeploy --restart always \
    -p {panel_p}:{panel_p} -p {panel_p}:3000 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /data/masterdeploy:/app/data \
    -e PORT={panel_p} \
    masterdeploy;
echo '✅ MasterDeploy Paneli Quraşdırıldı! Port: {panel_p}';
"""

    def get_cmd_all(self, swap_gb, panel_p, port_p):
        swap_cmd = self.get_cmd_swap(swap_gb, panel_p, port_p)
        git_cmd = self.get_cmd_git(swap_gb, panel_p, port_p)
        docker_cmd = self.get_cmd_docker(swap_gb, panel_p, port_p)
        panel_cmd = self.get_cmd_panel(swap_gb, panel_p, port_p)
        
        return f"{swap_cmd}\n{git_cmd}\n{docker_cmd}\n{panel_cmd}"

    def get_cmd_clean(self, swap_gb, panel_p, port_p):
        return """
echo 'MasterDeploy Paneli və Docker konteynerləri sıfırlanır...';
sudo docker stop $(sudo docker ps -aq) 2>/dev/null || true;
sudo docker rm $(sudo docker ps -aq) 2>/dev/null || true;
sudo docker rmi $(sudo docker images -q) 2>/dev/null || true;
sudo rm -rf /data/masterdeploy;
sudo ufw reset --force;
echo '✅ Bütün təmizlik işləri uğurla bitdi!';
"""

    def get_cmd_portainer(self, swap_gb, panel_p, port_p):
        return f"""
echo 'Portainer quraşdırılır...';
sudo ufw allow {port_p}/tcp 2>/dev/null || true;
sudo docker stop portainer 2>/dev/null || true;
sudo docker rm portainer 2>/dev/null || true;
sudo docker run -d -p {port_p}:9000 --name portainer --restart=always \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v portainer_data:/data \
    portainer/portainer-ce:latest --no-setup-token;
echo '✅ Portainer quruldu! Port: {port_p}';
"""

    def get_cmd_cloudflare(self, swap_gb, panel_p, port_p):
        return """
echo 'Cloudflared yoxlanılır və quraşdırılır...';
if ! command -v cloudflared > /dev/null 2>&1; then
    sudo mkdir -p --mode=0755 /usr/share/keyrings;
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null;
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared debian-stable main' | sudo tee /etc/apt/sources.list.d/cloudflared.list > /dev/null;
    sudo apt-get update && sudo apt-get install -y cloudflared;
    echo '✅ Cloudflared uğurla quraşdırıldı!';
else
    echo '✅ Cloudflared artıq mövcuddur: '$(cloudflared --version);
fi;
"""

    def run_remote_task(self, cmd_func, confirm=None):
        if not self.gui: return
        if confirm and not messagebox.askyesno("Təsdiq", confirm): return
        
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        swap_gb = self.gui.swap_entry.get().strip()
        if not swap_gb.isdigit(): swap_gb = "2"
        panel_port = self.gui.panel_port_entry.get().strip() or "3000"
        portainer_port = self.gui.portainer_port_entry.get().strip() or "9000"
        
        self.save_config()
        cmd = cmd_func(swap_gb, panel_port, portainer_port)
        
        self.log_remote(f"\n--- Əməliyyat Başladı: {user}@{ip} ---")
        self.gui.toggle_remote_buttons(tk.DISABLED)
        
        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", "-i", key_path, f"{user}@{ip}", f"bash -s"]
            try:
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                proc = subprocess.Popen(ssh_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace', creationflags=creationflags)
                
                # Komandaları stdin vasitəsilə ötürürük və bağlayırıq
                proc.stdin.write(cmd)
                proc.stdin.close()
                
                # Canlı olaraq oxuyuruq
                while True:
                    line = proc.stdout.readline()
                    if not line and proc.poll() is not None:
                        break
                    if line:
                        self.log_remote(line.rstrip('\r\n'))
                
                proc.wait()
                if proc.returncode == 0:
                    self.log_remote("✅ UZAQ SERVERDƏ ƏMƏLİYYAT UĞURLA BİTDİ!")
                else:
                    self.log_remote(f"❌ Əməliyyat xəta kodu ilə bitdi: {proc.returncode}")
            except Exception as e:
                self.log_remote(f"❌ Xəta baş verdi: {e}")
            self.gui.root.after(0, lambda: self.gui.toggle_remote_buttons(tk.NORMAL))
            self.gui.root.after(200, self.check_remote_fw_status)
            
        threading.Thread(target=task, daemon=True).start()

    def run_custom_remote_command(self, cmd):
        if not self.gui: return
        ip = self.gui.ip_entry.get().strip()
        user = self.gui.user_entry.get().strip()
        key_path = self.gui.key_entry.get().strip()
        if not ip or not user or not key_path:
            messagebox.showwarning("Xəta", "Server məlumatlarını doldurun!")
            return
            
        self.log_remote(f"\n💻 [Terminal CMD] {user}@{ip}:~$ {cmd}")
        self.gui.toggle_remote_buttons(tk.DISABLED)
        
        def task():
            ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15", "-i", key_path, f"{user}@{ip}", cmd]
            try:
                creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                proc = subprocess.Popen(
                    ssh_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding='utf-8',
                    errors='replace',
                    creationflags=creationflags
                )
                while True:
                    line = proc.stdout.readline()
                    if not line and proc.poll() is not None:
                        break
                    if line:
                        self.log_remote(line.rstrip('\r\n'))
                proc.wait()
            except Exception as e:
                self.log_remote(f"❌ Xəta baş verdi: {e}")
            self.gui.root.after(0, lambda: self.gui.toggle_remote_buttons(tk.NORMAL))
            
        threading.Thread(target=task, daemon=True).start()

    def run_custom_local_command(self, cmd):
        if not self.gui: return
        if os.name == 'nt':
            messagebox.showerror("Xəta", "Yerli terminal yalnız Linux sistemləri üçündür!")
            return
            
        sudo_pass = self.gui.local_pass_entry.get().strip()
        self.log_local(f"\n💻 [Terminal Local]:~$ {cmd}")
        self.gui.toggle_local_buttons(tk.DISABLED)
        
        # Əgər əmr sudo tələb edirsə, parolu avtomatik ötürə bilək
        if "sudo " in cmd and sudo_pass:
            cmd = cmd.replace("sudo ", f"echo '{sudo_pass}' | sudo -S ")
            
        def task():
            try:
                proc = subprocess.Popen(
                    ["bash", "-c", cmd],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding='utf-8',
                    errors='replace'
                )
                while True:
                    line = proc.stdout.readline()
                    if not line and proc.poll() is not None:
                        break
                    if line:
                        self.log_local(line.rstrip('\r\n'))
                proc.wait()
            except Exception as e:
                self.log_local(f"❌ Xəta: {e}")
            self.gui.root.after(0, lambda: self.gui.toggle_local_buttons(tk.NORMAL))
            
        threading.Thread(target=task, daemon=True).start()

    def trigger_portainer_token(self, is_local=False):
        ip = "127.0.0.1" if is_local else self.gui.ip_entry.get().strip()
        port = self.gui.local_portainer_port_entry.get().strip() if is_local else self.gui.portainer_port_entry.get().strip()
        
        if not port:
            messagebox.showwarning("Xəta", "Portainer portunu daxil edin!")
            return
            
        log_func = self.log_local if is_local else self.log_remote
        log_func("\n--- Portainer Token Yaradılır... ---")
        
        def logger(msg):
            log_func(msg)
            
        def task():
            setup_token = ""
            try:
                if is_local:
                    sudo_pass = self.gui.local_pass_entry.get().strip()
                    cmd = ["sudo", "-S", "docker", "logs", "portainer"]
                    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                    out, _ = proc.communicate(input=sudo_pass + "\n", timeout=10)
                    for line in out.split('\n'):
                        if "setup_token=" in line:
                            setup_token = line.split("setup_token=")[1].strip()
                            break
                else:
                    user = self.gui.user_entry.get().strip()
                    key_path = self.gui.key_entry.get().strip()
                    ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-i", key_path, f"{user}@{ip}", "sudo docker logs portainer"]
                    creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                    proc = subprocess.run(ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=10, creationflags=creationflags)
                    for line in proc.stdout.split('\n'):
                        if "setup_token=" in line:
                            setup_token = line.split("setup_token=")[1].strip()
                            break
            except Exception as e:
                logger(f"❌ Setup Token oxunarkən xəta: {e}")
                return

            if not setup_token:
                logger("⚠️ Setup Token tapılmadı (Portainer artıq konfiqurasiya olunub və ya işləmir).")
                return
                
            logger(f"✅ Setup Token tapıldı: {setup_token[:6]}...")
            
            # API Request
            try:
                url = f"http://{ip}:{port}/api/users/admin/init"
                payload = {"Username": "admin", "Password": "MasterDeploy12345", "SetupToken": setup_token}
                status, resp = self.send_json_request(url, "POST", payload)
                if status == 200:
                    logger("✅ Portainer admin parolu təyin olundu!")
                elif status == 409:
                    logger("ℹ️ Portainer artıq aktivləşdirilib.")
                else:
                    logger(f"❌ Xəta (Admin təyini): {resp}")
            except Exception as e:
                logger(f"❌ API qoşulma xətası: {e}")
                return
                
            # Get JWT Token
            try:
                url = f"http://{ip}:{port}/api/auth"
                payload = {"Username": "admin", "Password": "MasterDeploy12345"}
                status, resp = self.send_json_request(url, "POST", payload)
                if status == 200:
                    jwt = resp.get("jwt")
                    logger("✅ JWT Token alındı!")
                else:
                    logger("❌ Avtorizasiya xətası!")
                    return
            except Exception as e:
                logger(f"❌ API Auth xətası: {e}")
                return
                
            # Create API Token
            try:
                url = f"http://{ip}:{port}/api/users/2/tokens" # Portainer CE-də admin adətən ID 2-dir (bəzən 1)
                headers = {"Authorization": f"Bearer {jwt}"}
                payload = {"description": "MasterDeploy-Token"}
                status, resp = self.send_json_request(url, "POST", payload, headers)
                if status != 200:
                    # Alternativ olaraq ID 1-i yoxlayırıq
                    url = f"http://{ip}:{port}/api/users/1/tokens"
                    status, resp = self.send_json_request(url, "POST", payload, headers)
                    
                if status == 200:
                    token = resp.get("token")
                    logger("🎉 API Token uğurla yaradıldı!")
                    self.gui.root.after(0, lambda: self.show_token_window(token))
                else:
                    logger(f"❌ API Token yaradıla bilmədi: {resp}")
            except Exception as e:
                logger(f"❌ Token yaratma API xətası: {e}")
                
        threading.Thread(target=task, daemon=True).start()

    def send_json_request(self, url, method="GET", payload=None, extra_headers=None):
        req_headers = {"Content-Type": "application/json"}
        if extra_headers:
            req_headers.update(extra_headers)
            
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

    def show_token_window(self, token):
        win = tk.Toplevel(self.gui.root)
        win.title("🔑 MasterDeploy Tokeni")
        win.geometry("500x200")
        win.configure(bg="#1E1E1E")
        win.grab_set()
        
        tk.Label(win, text="Portainer API Tokeniniz:", font=self.gui.font_title, bg="#1E1E1E", fg=ACCENT_COLOR).pack(pady=10)
        
        token_entry = tk.Entry(win, width=50, font=("Consolas", 10), bg=ENTRY_BG, fg="#00FF00", insertbackground="white", relief=tk.FLAT)
        token_entry.pack(pady=5, ipady=5)
        token_entry.insert(0, token)
        token_entry.config(state="readonly")
        
        def copy_btn():
            self.gui.root.clipboard_clear()
            self.gui.root.clipboard_append(token)
            messagebox.showinfo("Kopyalandı", "Token yaddaşa kopyalandı!", parent=win)
            win.destroy()
            
        self.gui.create_button(win, "📄 Kopyala və Bağla", BTN_ALL, copy_btn).pack(pady=10, ipady=4, ipadx=10)

if __name__ == "__main__":
    root = tk.Tk()
    backend = RemoteInstallerLogic()
    app = RemoteInstallerGUI(root, backend)
    root.mainloop()
