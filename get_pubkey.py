import sqlite3, subprocess, os
con = sqlite3.connect('local_data/masterdeploy.db')
r = con.execute("SELECT private_key FROM ssh_keys WHERE id = 'e63500be-8a21-4dec-962c-155efbf5b44a'").fetchone()

temp_key = os.path.abspath('temp_k.pem')
with open(temp_key, 'w', newline='\n') as f:
    f.write(r[0].replace('\r\n', '\n').strip() + '\n')

whoami = os.popen('whoami').read().strip()
subprocess.run(['icacls', temp_key, '/reset'], capture_output=True)
subprocess.run(['icacls', temp_key, '/inheritance:r'], capture_output=True)
subprocess.run(['icacls', temp_key, '/grant:r', f'{whoami}:(R)'], capture_output=True)
subprocess.run(['icacls', temp_key, '/remove', 'SYSTEM'], capture_output=True)
subprocess.run(['icacls', temp_key, '/remove', 'Administrators'], capture_output=True)

out = subprocess.run(['ssh-keygen', '-y', '-f', temp_key], capture_output=True, text=True)
print('CALCULATED_PUBKEY:', out.stdout.strip())
print('KEYGEN_ERR:', out.stderr.strip())

# indi ssh sınayaq:
out_ssh = subprocess.run([
    r'C:\Windows\System32\OpenSSH\ssh.exe',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-i', temp_key,
    'ubuntu@84.8.148.216',
    'free -m'
], capture_output=True, text=True)

print('SSH_STDOUT:', out_ssh.stdout)
print('SSH_STDERR:', out_ssh.stderr)
print('SSH_RC:', out_ssh.returncode)

if os.path.exists(temp_key):
    os.remove(temp_key)
