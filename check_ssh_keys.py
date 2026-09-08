import os, subprocess

ssh_dir = os.path.expanduser('~/.ssh')
for f in ['id_rsa', 'temp_key.key', 'temp_key.pem', 'temp_key_new.key']:
    p = os.path.join(ssh_dir, f)
    if os.path.exists(p):
        pub = subprocess.run(['ssh-keygen', '-y', '-f', p], capture_output=True, text=True).stdout.strip()
        print(f"FILE: {f} -> {pub[:60]}... (len: {len(pub)})")

        # try ssh
        test_conn = subprocess.run([
            r'C:\Windows\System32\OpenSSH\ssh.exe',
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=3',
            '-i', p,
            'ubuntu@84.8.148.216',
            'free -m'
        ], capture_output=True, text=True)
        print(f"   SSH RESULT for {f}: rc={test_conn.returncode}, out={test_conn.stdout.strip()[:40]}, err={test_conn.stderr.strip()[:40]}")
