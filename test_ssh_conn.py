import sqlite3, os, subprocess

con = sqlite3.connect('local_data/masterdeploy.db')
r = con.execute("SELECT private_key FROM ssh_keys WHERE id = 'e63500be-8a21-4dec-962c-155efbf5b44a'").fetchone()
if not r or not r[0]:
    print("Acar tapilmadi!")
    exit(1)

key = r[0].replace('\r\n', '\n').strip() + '\n'

home_ssh = os.path.expanduser('~/.ssh')
os.makedirs(home_ssh, exist_ok=True)
key_file = os.path.join(home_ssh, 'oracle_temp.key')

with open(key_file, 'w', newline='\n') as f:
    f.write(key)

user = os.environ.get('USERNAME')
subprocess.run(['icacls', key_file, '/inheritance:r'], capture_output=True)
subprocess.run(['icacls', key_file, '/grant:r', f'{user}:(R)'], capture_output=True)

res = subprocess.run([
    r'C:\Windows\System32\OpenSSH\ssh.exe',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=5',
    '-i', key_file,
    'ubuntu@84.8.148.216',
    'free -m'
], capture_output=True, text=True)

print('STDOUT:', res.stdout)
print('STDERR:', res.stderr)
print('RETURNCODE:', res.returncode)

if os.path.exists(key_file):
    os.remove(key_file)
