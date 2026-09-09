# 🤖 Mərhələ 2: Uzaq Server (VM) Daemon və Watchdog Planı

## 📌 Məqsəd
Uzaq VM-də müstəqil işləyən, MasterDeploy-dan asılı olmayan arxa plan xidməti (`md-tunnel-daemon`) yaratmaq.

---

## 🏗️ Daemon İşləmə Axını (Sequence Diagram)

```mermaid
sequenceDiagram
    participant Master as MasterDeploy
    participant VM_Daemon as VM Watchdog Daemon
    participant CF_CLI as Cloudflared Process
    participant CF_KV as Cloudflare KV API

    Master->>VM_Daemon: SSH ilə konfiqurasiyanı ötürür (Tünel Adı, Portlar, CF Token)
    VM_Daemon->>CF_CLI: "cloudflared tunnel --url ..." əmrini başladır
    Note over VM_Daemon,CF_CLI: Daemon prosesi nəzarətdə saxlayır (Auto-Restart)
    CF_CLI-->>VM_Daemon: Yeni link yaranır: "https://xyz-abc.trycloudflare.com"
    VM_Daemon->>CF_KV: Birbaşa HTTPS PUT ilə yeni linki yazır
    Note over CF_KV: Cloudflare Worker dərhal yeni linki tanıyır!
    Master--xVM_Daemon: [MasterDeploy SÖNÜR / ÇÖKÜR]
    Note over VM_Daemon,CF_KV: VM Daemon öz işinə fasiləsiz davam edir, link ölmür!
```

---

## 📝 Görüləcək İşlər:
1. **Agent Skripti (`scripts/tunnel_agent.py` və ya shell daemon):**
   - Hər bir tünel üçün `cloudflared` prosesini başladır.
   - Loqları süzüb `trycloudflare.com` linkini tutur.
   - Cloudflare API tokenindən istifadə edərək birbaşa `api.cloudflare.com/client/v4/.../storage/kv/...` ünvanına PUT göndərir.
   - Şəbəkə qırıldıqda və ya tünel düşdükdə avtomatik təkrar qaldırır və yeni linki Cloudflare-ə çatdırır.
2. **Systemd Servis Şablonu:**
   - VM-də `md-tunnel.service` kimi quraşdırılması üçün servis konfiqurasiyası.
3. **Ortaq Tünel üçün Daxili Routing (Multi-Port):**
   - Əgər `A Tüneli`nə birdən çox layihə bağlanıbsa, VM daxilində kiçik yüngül Nginx və ya Caddy routerinin generasiya edilməsi.
