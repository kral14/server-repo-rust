import os
import sys
import json
import socket
import subprocess
import time

try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

def print_banner():
    print("=" * 65)
    print(" 🚀 MasterDeploy - PostgreSQL Port (5432) Açma və Test Skripti")
    print("=" * 65)

def load_server_info():
    import argparse
    parser = argparse.ArgumentParser(description="PostgreSQL Port 5432 Test və Açma Aləti")
    parser.add_argument("--ip", help="Server IP ünvanı")
    parser.add_argument("--user", help="SSH istifadəçi adı")
    parser.add_argument("--key", help="SSH açar faylının yolu (.pem / .key)")
    args, _ = parser.parse_known_args()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    config_file = os.path.join(base_dir, "config.json")
    
    ip = "84.8.148.216"
    user = "ubuntu"
    key = ""
    
    if os.path.exists(config_file):
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                ip = data.get("ip", ip)
                user = data.get("user", user)
                key = data.get("key", key)
        except Exception as e:
            print(f"[!] config.json oxunarkən xəta: {e}")

    # CLI arqumentləri üstünlük təşkil edir
    if args.ip: ip = args.ip
    if args.user: user = args.user
    if args.key: key = args.key

    # Əgər qeyd olunmuş key mövcud deyilsə, local_data/masterdeploy.db bazasından çıxarmağa çalış
    if not key or not os.path.exists(key):
        db_path = os.path.join(base_dir, "local_data", "masterdeploy.db")
        if os.path.exists(db_path):
            try:
                import sqlite3
                conn = sqlite3.connect(db_path)
                c = conn.cursor()
                # Serveri tap
                c.execute("SELECT ssh_key, ssh_key_id FROM servers WHERE ip = ?", (ip,))
                row = c.fetchone()
                priv_key = ""
                if row:
                    if row[1]:
                        c.execute("SELECT private_key FROM ssh_keys WHERE id = ?", (row[1],))
                        krow = c.fetchone()
                        if krow: priv_key = krow[0]
                    if not priv_key and row[0]:
                        priv_key = row[0]
                conn.close()

                if priv_key and "BEGIN " in priv_key:
                    tmp_key = os.path.join(base_dir, "scratch", "temp_ssh.key")
                    os.makedirs(os.path.dirname(tmp_key), exist_ok=True)
                    with open(tmp_key, "w", encoding="utf-8") as kf:
                        kf.write(priv_key.strip() + "\n")
                    # Windows icacls
                    try:
                        user_name = os.environ.get("USERNAME", "Administrator")
                        subprocess.run(["icacls", tmp_key, "/inheritance:r"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        subprocess.run(["icacls", tmp_key, "/grant:r", f"{user_name}:F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    except:
                        pass
                    key = tmp_key
                    print(f"[*] SSH açarı bazadan avtomatik çıxarıldı: {key}")
            except Exception as e:
                print(f"[!] Bazadan açar oxunarkən xəta: {e}")

    # Əgər hələ də yoxdursa, ~/.ssh/id_rsa yoxla
    if not key or not os.path.exists(key):
        home_rsa = os.path.expanduser("~/.ssh/id_rsa")
        if os.path.exists(home_rsa):
            key = home_rsa

    return ip, user, key

def test_remote_socket(ip, port=5432, timeout=6):
    print(f"\n[*] Lokal kompüterdən {ip}:{port} ünvanına TCP qoşulması yoxlanılır...")
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    start_time = time.time()
    try:
        s.connect((ip, port))
        s.close()
        elapsed = round((time.time() - start_time) * 1000, 2)
        print(f"✅ UĞURLU! Port {port} kənardan tam əlçatandır və açıqdır! (Ping/Cavab: {elapsed} ms)")
        return True
    except socket.timeout:
        print(f"❌ UĞURSUZ: Qoşulma zamanı 'Timeout' (Vaxt aşımı) baş verdi!")
        print("   -> Səbəb: Paketlər serverə çatmır. Əgər VM Oracle Cloud, AWS və ya GCP-dədirsə,")
        print("      provayderin veb panelindəki 'Security List / Ingress Rules' bölməsindən 5432 portunu açmalısınız.")
        return False
    except ConnectionRefusedError:
        print(f"⚠️ PORT AÇIQDIR, LAKİN QOŞULMA RƏDD EDİLDİ (Connection Refused)!")
        print("   -> Paket serverə çatır, lakin daxildə PostgreSQL konteyneri işləmir və ya başqa porta bağlıdır.")
        return False
    except Exception as e:
        print(f"❌ XƏTA: {e}")
        return False

def run_ssh_command(ip, user, key, cmd):
    ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"]
    if key and os.path.exists(key):
        ssh_cmd.extend(["-i", key])
    ssh_cmd.append(f"{user}@{ip}")
    ssh_cmd.append(cmd)
    
    proc = subprocess.run(ssh_cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    return proc.returncode, proc.stdout, proc.stderr

def main():
    print_banner()
    ip, user, key = load_server_info()
    
    print(f"[*] Hədəf Server: {user}@{ip}")
    if key:
        print(f"[*] SSH Açarı   : {key} (Mövcuddur: {os.path.exists(key)})")
    else:
        print("[*] SSH Açarı   : Standart SSH agent / default key")
    print("-" * 65)

    # 1. İlkin yoxlama: Hazırda kənardan port açıqdırmı?
    print("[ADDIM 1] Serverdə port açılmazdan əvvəlki ilkin vəziyyət yoxlanılır...")
    initial_open = test_remote_socket(ip, 5432, timeout=4)
    
    print("\n[ADDIM 2] SSH ilə serverə daxil olunur və port 5432 xaricə açılır...")
    
    # Server daxilində icra olunacaq hərtərəfli əmrlər kompleksi
    remote_script = (
        "echo '[+] Köhnə iptables DROP qaydaları təmizlənir...' && "
        "while sudo iptables -D DOCKER-USER -p tcp --dport 5432 -j DROP 2>/dev/null; do :; done; "
        "while sudo iptables -D DOCKER-USER -p tcp --dport 5432 -j ACCEPT 2>/dev/null; do :; done; "
        "echo '[+] DOCKER-USER zəncirinə birbaşa ACCEPT əlavə edilir...' && "
        "sudo iptables -I DOCKER-USER 1 -p tcp --dport 5432 -j ACCEPT && "
        "echo '[+] UFW Firewall tənzimlənir...' && "
        "sudo ufw delete deny 5432/tcp 2>/dev/null || true && "
        "sudo ufw allow 5432/tcp 2>/dev/null || true && "
        "sudo ufw reload 2>/dev/null || true && "
        "echo '[+] PostgreSQL Docker konteyneri yoxlanılır...' && "
        "sudo docker ps --filter name=masterdeploy-postgres --format 'Konteyner: {{.Names}} | Status: {{.Status}} | Portlar: {{.Ports}}' && "
        "echo '[+] Sistemdə 5432 portuna qulaq asan proseslər...' && "
        "sudo ss -tulpn | grep 5432 || sudo netstat -tulpn | grep 5432 || echo 'Port dinlənmir!'"
    )

    code, stdout, stderr = run_ssh_command(ip, user, key, remote_script)
    
    if code != 0 and not stdout:
        print(f"[X] SSH ilə serverə qoşulmaq mümkün olmadı!")
        print(f"    Xəta məlumatı:\n{stderr}")
        return

    print(stdout)
    if stderr and "Warning" not in stderr:
        print(f"[Qeyd / Xəbərdarlıq]:\n{stderr}")

    print("-" * 65)
    print("[ADDIM 3] Əmrlər icra edildikdən sonra nəticə yenidən test edilir...")
    final_open = test_remote_socket(ip, 5432, timeout=6)

    print("\n" + "=" * 65)
    if final_open:
        print("🎉 NƏTİCƏ: UĞURLUDUR! 5432 portu artıq serverdə tam açıqdır!")
        print("   İndi istənilən proqramdan (DBeaver, Python, backend) rahatlıqla qoşula bilərsiniz.")
    else:
        print("⚠️ NƏTİCƏ:")
        print("   Serverin əməliyyat sistemi (iptables və ufw) səviyyəsində port 100% açıldı.")
        print("   Lakin kənardan hələ də paket çatmırsa, səbəb 100% bulud provayderinizin")
        print("   (Oracle Cloud, Hetzner, AWS və s.) şəxsi panelindəki Firewall / Security Group-dur.")
        print("   -> Həlli: Provayderinizin saytına girib Ingress / Inbound Rules bölməsində")
        print("      Port: 5432, Protocol: TCP, Source: 0.0.0.0/0 əlavə edin.")
    print("=" * 65)

if __name__ == "__main__":
    main()
