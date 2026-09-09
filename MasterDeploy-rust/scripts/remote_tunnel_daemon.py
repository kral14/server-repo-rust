#!/usr/bin/env python3
"""
MasterDeploy Multi-Tunnel Watchdog Daemon for Remote VM
Bu skript uzaq serverdə (VM) müstəqil işləyir.
Funksiyaları:
1. Konfiqurasiya faylından (/etc/masterdeploy/tunnels.json) tünelləri oxuyur.
2. Hər bir tünel üçün `cloudflared` prosesini canlı saxlayır (Auto-restart & health check).
3. Yeni trycloudflare.com linki yarananda onu birbaşa Cloudflare KV bazasına yazır (MasterDeploy sönük olsa belə!).
4. Əgər bir tünelə birdən çox port (layihə) bağlıdırsa, daxili reverse proxy vasitəsilə yönləndirir.
"""

import os
import sys
import time
import json
import re
import subprocess
import threading
import urllib.request
import urllib.error

CONFIG_DIR = "/etc/masterdeploy"
CONFIG_FILE = os.path.join(CONFIG_DIR, "tunnels.json")
STATUS_FILE = os.path.join(CONFIG_DIR, "status.json")

def log(msg):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] [MD-TUNNEL-DAEMON] {msg}", flush=True)

def load_config():
    if not os.path.exists(CONFIG_FILE):
        return {"cloudflare": {}, "tunnels": []}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log(f"Xəta konfiqurasiya oxunarkən: {e}")
        return {"cloudflare": {}, "tunnels": []}

def save_status(status_data):
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(status_data, f, indent=2)
    except Exception as e:
        log(f"Status saxlanılarkən xəta: {e}")

def update_cloudflare_kv(cf_config, app_keys, public_url):
    """
    Cloudflare KV bazasına birbaşa PUT sorğusu göndərir.
    MasterDeploy-dan tam asılı olmadan işləyir.
    """
    api_token = cf_config.get("api_token")
    account_id = cf_config.get("account_id")
    kv_id = cf_config.get("kv_id")

    if not api_token or not account_id or not kv_id:
        log("Cloudflare KV parametrləri tam deyil, KV yenilənməsi atlandı.")
        return False

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "text/plain"
    }

    success = True
    for key in app_keys:
        kv_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{kv_id}/values/{key}"
        try:
            req = urllib.request.Request(kv_url, data=public_url.encode("utf-8"), headers=headers, method="PUT")
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status in (200, 201):
                    log(f"✅ Cloudflare KV uğurla yeniləndi! Key: '{key}' -> '{public_url}'")
                else:
                    log(f"⚠️ Cloudflare KV status {resp.status} qaytardı (Key: {key})")
        except Exception as e:
            log(f"❌ Cloudflare KV yazılarkən xəta (Key: {key}): {e}")
            success = False
    return success

class TunnelWorker(threading.Thread):
    def __init__(self, tunnel_info, cf_config, status_dict):
        super().__init__(daemon=True)
        self.tunnel = tunnel_info
        self.cf_config = cf_config
        self.status_dict = status_dict
        self.running = True
        self.process = None

    def run(self):
        tunnel_id = self.tunnel.get("id", "default")
        tunnel_name = self.tunnel.get("name", "unnamed")
        target_port = self.tunnel.get("target_port", 8080)
        app_keys = self.tunnel.get("app_keys", [])

        log(f"🚀 Tünel işə salınır: '{tunnel_name}' (Port: {target_port}, App Keys: {app_keys})")

        while self.running:
            # cloudflared prosesini başladırıq
            cmd = ["cloudflared", "tunnel", "--url", f"http://localhost:{target_port}"]
            try:
                self.process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1
                )
            except FileNotFoundError:
                log("❌ 'cloudflared' tapılmadı! Zəhmət olmasa cloudflared quraşdırın.")
                time.sleep(10)
                continue

            active_url = None
            for line in self.process.stdout:
                line_str = line.strip()
                # URL axtarışı
                if ".trycloudflare.com" in line_str:
                    match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line_str)
                    if match:
                        found_url = match.group(0)
                        if found_url != active_url:
                            active_url = found_url
                            log(f"🎉 Yeni canlı tünel linki tutuldu: {active_url}")
                            self.status_dict[tunnel_id] = {
                                "name": tunnel_name,
                                "status": "active",
                                "public_url": active_url,
                                "last_updated": time.strftime("%Y-%m-%d %H:%M:%S")
                            }
                            save_status(self.status_dict)
                            # Cloudflare KV-yə birbaşa yazırıq
                            update_cloudflare_kv(self.cf_config, app_keys, active_url)

                if not self.running:
                    break

            if self.process:
                self.process.poll()
                log(f"⚠️ Tünel prosesi dayandı ('{tunnel_name}'). 5 saniyə sonra təkrar bərpa olunur...")
            time.sleep(5)

    def stop(self):
        self.running = False
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=3)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass

def main():
    log("MasterDeploy Multi-Tunnel Watchdog Daemon işə başladı.")
    os.makedirs(CONFIG_DIR, exist_ok=True)

    workers = {}
    status_dict = {}

    while True:
        config = load_config()
        cf_config = config.get("cloudflare", {})
        tunnels = config.get("tunnels", [])

        active_tunnel_ids = set()
        for t in tunnels:
            t_id = t.get("id")
            if not t_id:
                continue
            active_tunnel_ids.add(t_id)

            if t_id not in workers or not workers[t_id].is_alive():
                worker = TunnelWorker(t, cf_config, status_dict)
                workers[t_id] = worker
                worker.start()

        # Konfiqurasiyadan silinmiş tünelləri dayandırırıq
        dead_ids = [t_id for t_id in workers if t_id not in active_tunnel_ids]
        for d_id in dead_ids:
            log(f"Tünel konfiqurasiyadan çıxarıldı, dayandırılır: {d_id}")
            workers[d_id].stop()
            del workers[d_id]
            if d_id in status_dict:
                del status_dict[d_id]
            save_status(status_dict)

        time.sleep(3)

if __name__ == "__main__":
    main()
