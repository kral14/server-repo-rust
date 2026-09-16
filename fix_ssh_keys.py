import os
import sys
import sqlite3
import subprocess

try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

base_dir = r"e:\mezuniyyet-rust-taurisiz-olan\server-repo-rust"
db_path = os.path.join(base_dir, "local_data", "masterdeploy.db")

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    
    # 132 açarını çıxarırıq
    c.execute("SELECT private_key FROM ssh_keys WHERE id = '79fc6635-c485-4044-9669-24eae983cfa5'")
    row_132 = c.fetchone()
    if row_132 and row_132[0]:
        k132_path = os.path.join(base_dir, "ssh-key-132.key")
        with open(k132_path, "w", encoding="utf-8") as f:
            f.write(row_132[0].strip() + "\n")
        print(f"[*] 132 açarı yazıldı: {k132_path}")
        
        # Scratch qovluğuna da yazaq
        scratch_dir = r"C:\Users\nesib\.gemini\antigravity-ide\scratch\mezuniyyet-rust-taurisiz-olan\server-repo-rust"
        os.makedirs(scratch_dir, exist_ok=True)
        with open(os.path.join(scratch_dir, "ssh-key-132.key"), "w", encoding="utf-8") as f:
            f.write(row_132[0].strip() + "\n")
        print(f"[*] Scratch-ə də yazıldı: {scratch_dir}")

    # 84 açarını çıxarırıq (Oracle VM-key)
    c.execute("SELECT private_key FROM ssh_keys WHERE id = 'd4ba9f42-6bbd-4d38-9e68-f96ab42e0e9d'")
    row_84 = c.fetchone()
    if row_84 and row_84[0]:
        k84_path = os.path.join(base_dir, "ssh-key-MasterDeploy.key")
        with open(k84_path, "w", encoding="utf-8") as f:
            f.write(row_84[0].strip() + "\n")
        print(f"[*] 84 açarı yazıldı: {k84_path}")

    conn.close()

# İndi Windows icacls icazələrini düzəldirik (Permission denied olmasın deyə)
user = os.environ.get("USERNAME", "nesib")
keys_to_fix = [
    os.path.join(base_dir, "ssh-key-MasterDeploy.key"),
    os.path.join(base_dir, "ssh-key-132.key"),
    os.path.join(base_dir, "scratch", "temp_ssh.key"),
    r"C:\Users\nesib\.gemini\antigravity-ide\scratch\mezuniyyet-rust-taurisiz-olan\server-repo-rust\ssh-key-132.key"
]

for k in keys_to_fix:
    if os.path.exists(k):
        subprocess.run(["icacls", k, "/inheritance:r"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["icacls", k, "/grant:r", f"{user}:F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[+] İcazələr düzəldildi: {k}")

print("\n--- Əlaqələrin Yoxlanışı ---")
# 84 serverini yoxlayaq
k84 = os.path.join(base_dir, "ssh-key-MasterDeploy.key")
p84 = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", k84, "ubuntu@84.8.148.216", "echo '84 OK'"], capture_output=True, text=True)
print(f"Server 84.8.148.216: {'✅ ƏLAQƏ UĞURLU' if '84 OK' in p84.stdout else '❌ XƏTA: ' + p84.stderr.strip()}")

# 132 serverini yoxlayaq
k132 = os.path.join(base_dir, "ssh-key-132.key")
p132 = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", k132, "ubuntu@132.145.76.194", "echo '132 OK'"], capture_output=True, text=True)
print(f"Server 132.145.76.194: {'✅ ƏLAQƏ UĞURLU' if '132 OK' in p132.stdout else '❌ XƏTA: ' + p132.stderr.strip()}")
