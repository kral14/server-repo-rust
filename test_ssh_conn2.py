import os, subprocess, sqlite3

con = sqlite3.connect('local_data/masterdeploy.db')
r = con.execute("SELECT private_key FROM ssh_keys WHERE id = 'e63500be-8a21-4dec-962c-155efbf5b44a'").fetchone()
key = r[0].replace('\r\n', '\n').strip() + '\n'

key_file = os.path.abspath('oracle_key.pem')
with open(key_file, 'w', newline='\n') as f:
    f.write(key)

whoami = os.popen('whoami').read().strip()
print('WHOAMI:', whoami)

os.system(f'icacls "{key_file}" /reset')
os.system(f'icacls "{key_file}" /inheritance:r')
os.system(f'icacls "{key_file}" /grant:r "{whoami}":R')

res = subprocess.run([
    r'C:\Windows\System32\OpenSSH\ssh.exe',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-i', key_file,
    'ubuntu@84.8.148.216',
    'free -m'
], capture_output=True, text=True, errors='replace')

print('STDOUT:', res.stdout)
print('STDERR:', res.stderr)
print('RC:', res.returncode)

if os.path.exists(key_file):
    os.remove(key_file)
