// --- Modul (Plugins) Menecment Sistemi ---
let installedPlugins = {};

async function loadPlugins() {
    try {
        const res = await fetch('/api/plugins');
        const plugins = await res.json();
        const container = document.getElementById('plugins-list');
        if (!container || !Array.isArray(plugins)) return;

        container.innerHTML = plugins.map(p => {
            installedPlugins[p.id] = p.installed;
            const isCf = p.id === 'cloudflare';
            return `
            <div class="plugin-card" style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); padding: 15px; border-radius: 12px; margin-bottom: 8px;">
                <div class="plugin-info-block">
                    <h3 style="margin: 0 0 5px 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">${p.name} <span class="plugin-version" style="font-size: 0.8rem; opacity: 0.6; font-family: monospace;">v${p.version}</span> ${isCf ? `<span onclick="openCloudflareHelpModal()" style="cursor: pointer; font-size: 0.72rem; background: rgba(0, 210, 255, 0.1); color: var(--accent-color); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(0, 210, 255, 0.2); font-weight: 600; display: inline-flex; align-items: center; gap: 3px;" title="Quraşdırma Təlimatı">❓ Təlimat</span>` : ''}</h3>
                    <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary);">${p.description}</p>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${isCf && p.installed ? `<span id="cf-plugin-status-badge" style="color: #ffb86c; font-size: 0.8rem; margin-right: 10px; font-weight: 500;">🟡 Yoxlanılır...</span>` : ''}
                    ${p.installed ?
                    `
                         ${isCf ? `<button class="btn btn-secondary" onclick="openCloudflareSetupModal()" style="padding: 6px 12px; font-size: 0.8rem; border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;">⚙️ Sazla</button>` : ''}
                         <button class="btn btn-secondary" onclick="uninstallPlugin('${p.id}')" style="color: var(--danger-color) !important; padding: 6px 12px; font-size: 0.8rem;">Uninstall</button>
                        ` :
                    `<button class="btn btn-primary" onclick="installPlugin('${p.id}')" style="padding: 6px 12px; font-size: 0.8rem;">Install</button>`
                }
                </div>
            </div>
            `;
        }).join('');

        // Cloudflare qoşulma statusunu arxa fonda ayrıca yoxlayıb yeniləyirik
        const cfPlugin = plugins.find(p => p.id === 'cloudflare');
        if (cfPlugin && cfPlugin.installed) {
            fetch('/api/plugins/cloudflare/check')
                .then(r => r.json())
                .then(checkData => {
                    const badge = document.getElementById('cf-plugin-status-badge');
                    if (badge) {
                        if (checkData.status === 'connected') {
                            badge.innerHTML = '🟢 Qoşulma aktivdir';
                            badge.style.color = '#00e676';
                        } else if (checkData.status === 'incomplete') {
                            badge.innerHTML = '🟡 Konfiqurasiya edilməyib';
                            badge.style.color = '#ffb86c';
                        } else {
                            badge.innerHTML = '🔴 Bağlantı xətası';
                            badge.style.color = '#ff5555';
                        }
                    }
                })
                .catch(() => {
                    const badge = document.getElementById('cf-plugin-status-badge');
                    if (badge) {
                        badge.innerHTML = '🔴 Bağlantı xətası';
                        badge.style.color = '#ff5555';
                    }
                });
        }
    } catch (e) {
        console.error("Failed to load plugins", e);
    }
}

async function installPlugin(id) {
    const card = event.target.closest('.plugin-card');
    const btnContainer = event.target.parentElement;
    btnContainer.innerHTML = `<span class="plugin-loading-spinner"></span> <span style="font-size:0.8rem; color:var(--text-secondary);">Quraşdırılır...</span>`;

    try {
        const res = await fetch(`/api/plugins/${id}/install`, { method: 'POST' });
        if (res.ok) {
            setTimeout(async () => {
                await loadPlugins();
                loadApplications();
                addActivityLog(`Modul quraşdırıldı: ${id}`, 'setup');
                if (id === 'cloudflare') {
                    // Avtomatik sazlama pəncərəsi açılsın
                    openCloudflareSetupModal();
                }
            }, 1500); // Vizual gözəllik üçün animasiyanı 1.5s saxlayırıq
        }
    } catch (e) {
        console.error(e);
    }
}

async function uninstallPlugin(id) {
    const card = event.target.closest('.plugin-card');
    const btnContainer = event.target.parentElement;
    btnContainer.innerHTML = `<span class="plugin-loading-spinner" style="border-top-color:var(--danger-color);"></span> <span style="font-size:0.8rem; color:var(--text-secondary);">Silinir...</span>`;

    try {
        const res = await fetch(`/api/plugins/${id}/uninstall`, { method: 'POST' });
        if (res.ok) {
            setTimeout(async () => {
                await loadPlugins();
                loadApplications();
                addActivityLog(`Modul silindi: ${id}`, 'delete');
            }, 1500);
        }
    } catch (e) {
        console.error(e);
    }
}

function openCloudflareHelpModal() {
    const template = document.getElementById('worker-code-template');
    if (template) {
        const appName = currentAppDetailsName || "yeni-test";
        template.innerHTML = `export default {
  async fetch(request, env, ctx) {
    // Layihə adı DƏQİQ MasterDeploy panelindəki ilə eyni olmalıdır
    const APP_NAME = "${appName}"; 

    // KV-dən canlı linki oxuyuruq
    const liveUrl = await env.TUNNEL_DB.get(appName);

    if (!liveUrl) {
      return new Response(\`[MasterDeploy] '\${APP_NAME}' üçün aktiv tünel tapılmadı. Zəhmət olmasa panelinizdən tüneli başladın.\`, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=UTF-8" }
      });
    }

    // Sorğunu canlı linkə yönləndiririk
    const url = new URL(request.url);
    const targetUrl = url.href.replace(url.origin, liveUrl.trim());

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual'
    });

    return fetch(modifiedRequest);
  }
}`;
    }
    showModal('cloudflare-help-modal');
}

function copyWorkerCodeToClipboard(btn) {
    const code = document.getElementById('worker-code-template').innerText;
    navigator.clipboard.writeText(code).then(() => {
        const origText = btn.innerHTML;
        btn.innerHTML = '✅ Kopyalandı!';
        btn.style.background = '#00e676';
        btn.style.color = '#fff';
        setTimeout(() => {
            btn.innerHTML = origText;
            btn.style.background = 'var(--accent-color)';
            btn.style.color = '#000';
        }, 2000);
    }).catch(err => {
        console.error('Kopyalama xətası:', err);
    });
}

// Cloudflare Modulu üçün Sazlama Funksiyaları
async function openCloudflareSetupModal() {
    try {
        const res = await fetch('/api/plugins/cloudflare/settings');
        if (res.ok) {
            const settings = await res.json();
            document.getElementById('cf-api-token').value = settings.api_token || '';
            document.getElementById('cf-account-id').value = settings.account_id || '';
            document.getElementById('cf-kv-id').value = settings.kv_id || '';
        }
    } catch (e) {
        console.error("Failed to load Cloudflare settings", e);
    }

    showModal('cloudflare-setup-modal');
    checkCloudflareConnection();
}

async function checkCloudflareConnection() {
    const indicator = document.getElementById('cf-connection-indicator');
    const text = document.getElementById('cf-connection-text');

    if (indicator && text) {
        indicator.className = 'status-indicator';
        indicator.style.background = '#ffb86c';
        text.innerText = 'Yoxlanılır...';
        text.style.color = '#ffb86c';
    }

    try {
        const res = await fetch('/api/plugins/cloudflare/check');
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'connected') {
                indicator.className = 'status-indicator online';
                indicator.style.background = '#00e676';
                text.innerText = 'Qoşulma aktivdir 🟢';
                text.style.color = '#00e676';
            } else if (data.status === 'incomplete') {
                indicator.className = 'status-indicator offline';
                indicator.style.background = '#ffb86c';
                text.innerText = 'Konfiqurasiya məlumatları tam doldurulmayıb.';
                text.style.color = '#ffb86c';
            } else {
                indicator.className = 'status-indicator offline';
                indicator.style.background = '#ff5555';
                text.innerText = data.message || 'Bağlantı xətası!';
                text.style.color = '#ff5555';
            }
        }
    } catch (e) {
        if (indicator && text) {
            indicator.className = 'status-indicator offline';
            indicator.style.background = '#ff5555';
            text.innerText = 'Şəbəkə xətası!';
            text.style.color = '#ff5555';
        }
    }
}

async function submitCloudflareSettings() {
    const api_token = document.getElementById('cf-api-token').value.trim();
    const account_id = document.getElementById('cf-account-id').value.trim();
    const kv_id = document.getElementById('cf-kv-id').value.trim();

    try {
        const res = await fetch('/api/plugins/cloudflare/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_token, account_id, kv_id, worker_url: "" })
        });
        if (res.ok) {
            alert('Sazlamalar uğurla yadda saxlanıldı!');
            await checkCloudflareConnection();
            loadPlugins();
        } else {
            alert('Sazlamaları yadda saxlamaq mümkün olmadı.');
        }
    } catch (e) {
        alert('Xəta baş verdi: ' + e.message);
    }
}

async function deployCloudflareWorker(appId) {
    if (!appId) { alert('Tətbiq ID tapılmadı.'); return; }
    const btn = document.getElementById('btn-deploy-cf-worker');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⌛ Yüklənir...';

    try {
        const res = await fetch(`/api/plugins/cloudflare/deploy-worker/${appId}`, {
            method: 'POST'
        });
        if (res.ok) {
            const data = await res.json();
            alert('Cloudflare Worker uğurla deploy edildi!');
            if (data.worker_url) {
                const urlInput = document.getElementById('settings-cf-worker-url');
                if (urlInput) urlInput.value = data.worker_url;
                
                const detailUrlSpan = document.getElementById('detail-app-url');
                const detailLink = document.getElementById('detail-app-link');
                if (detailUrlSpan) detailUrlSpan.innerText = data.worker_url;
                if (detailLink) detailLink.href = data.worker_url;
            }
            if (typeof loadApplications === 'function') loadApplications();
        } else {
            const errText = await res.text();
            alert('Worker deploy xətası: ' + errText);
        }
    } catch (e) {
        alert('Xəta baş verdi: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function deleteCloudflareWorker(appId) {
    if (!appId) { alert('Tətbiq ID tapılmadı.'); return; }
    if (!confirm('Bu tətbiqin Cloudflare Worker-ini və sabit linkini silmək istədiyinizdən əminsiniz?')) return;
    
    const btn = document.getElementById('btn-delete-cf-worker');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⌛ Silinir...';

    try {
        const res = await fetch(`/api/plugins/cloudflare/delete-worker/${appId}`, {
            method: 'POST'
        });
        if (res.ok) {
            alert('Cloudflare Worker uğurla silindi!');
            const urlInput = document.getElementById('settings-cf-worker-url');
            if (urlInput) urlInput.value = '';
            
            if (typeof openAppDetails === 'function') {
                openAppDetails(appId, false);
            }
            if (typeof loadApplications === 'function') loadApplications();
        } else {
            const errText = await res.text();
            alert('Worker silmə xətası: ' + errText);
        }
    } catch (e) {
        alert('Xəta baş verdi: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// 3 xətt menyusunu açmaq
function toggleAppMenu(event, appId) {
    event.stopPropagation();
    // Bütün digər açıq menyuları bağla və z-indexləri sıfırla
    document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
    document.querySelectorAll('.list-item').forEach(item => item.style.zIndex = 'auto');

    const menu = document.getElementById(`app-menu-${appId}`);
    if (menu) {
        const isClosed = menu.style.display === 'none' || menu.style.display === '';
        if (isClosed) {
            menu.style.display = 'flex';
            const listItem = menu.closest('.list-item');
            if (listItem) {
                listItem.style.zIndex = '1000';
            }
        } else {
            menu.style.display = 'none';
        }
    }
}

// Global click event ilə drop menyularını kənara basanda bağlamaq
document.addEventListener('click', () => {
    document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
    document.querySelectorAll('.list-item').forEach(item => item.style.zIndex = 'auto');
});

// Modallar açılanda pluginləri yüklə
const originalShowModal = showModal;
showModal = async function (id) {
    await originalShowModal(id);
    if (id === 'plugins-modal') {
        if (typeof loadPlugins === 'function') loadPlugins();
    }
};


// ── Cloudflare Modal & Tunnel Functions ──
let cfPollingInterval = null;
let currentCfAppId = null;

function openCloudflareModal(appId, appName) {
    let modal = document.getElementById('cf-terminal-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cf-terminal-modal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal-card" style="width: 780px; height: 500px; background: #1e1e1e; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                <div style="display: flex; flex-direction: row; flex: 1; min-height: 0; background: #0c0c0c; width: 100%; height: 100%;">
                    <!-- Left: Terminal -->
                    <div style="flex: 1; display: flex; flex-direction: column; background: #0c0c0c;">
                        <!-- Terminal body -->
                        <div id="cf-terminal-body" style="flex: 1; padding: 16px; overflow-y: auto; font-family: 'Consolas', 'Courier New', Courier, monospace; font-size: 0.85rem; color: #00e676; line-height: 1.5; text-align: left; white-space: pre-wrap; word-break: break-all;">
                            <div style="color: #888;">[SİSTEM] Cloudflare tünel sessiyası başladı...</div>
                            <div style="color: #888;">[SİSTEM] Uzaq serverlə bağlantı yoxlanılır...</div>
                        </div>
                        <!-- Terminal Input Prompt -->
                        <div style="background: #0c0c0c; padding: 10px 16px; display: flex; align-items: center; gap: 8px; font-family: 'Consolas', 'Courier New', Courier, monospace; font-size: 0.85rem; border-top: 1px solid #222;">
                            <span style="color: #00d2ff; white-space: nowrap;">ubuntu@masterdeploy:~$</span>
                            <input type="text" id="cf-terminal-input" style="flex: 1; background: transparent; border: none; outline: none; color: #fff; font-family: inherit; font-size: inherit;" placeholder="Komanda yazın..." disabled />
                        </div>
                    </div>
                    
                    <!-- Right: Commands Sidebar -->
                    <div style="width: 220px; background: #1e1e1e; border-left: 1px solid #333; padding: 16px; display: flex; flex-direction: column; gap: 12px; justify-content: flex-start; align-items: stretch; box-sizing: border-box; height: 100%; overflow-y: auto;">
                        <div style="color: #888; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px;">Əmrlər</div>
                        
                        <button id="cf-start-btn" onclick="runCfCommand('start')" style="background: #27ae60; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: not-allowed; font-size: 0.85rem; font-weight: bold; text-align: left; display: flex; align-items: center; gap: 8px; opacity: 0.5;" disabled>
                            <span>▶️</span> Tüneli Başlat
                        </button>
                        
                        <button id="cf-logs-btn" onclick="runCfCommand('logs')" style="background: #2980b9; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: not-allowed; font-size: 0.85rem; font-weight: bold; text-align: left; display: flex; align-items: center; gap: 8px; opacity: 0.5;" disabled>
                            <span>📋</span> Loqları İzlə
                        </button>
                        
                        <button id="cf-stop-btn" onclick="runCfCommand('stop')" style="background: #c0392b; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: not-allowed; font-size: 0.85rem; font-weight: bold; text-align: left; display: flex; align-items: center; gap: 8px; opacity: 0.5;" disabled>
                            <span>🛑</span> Tüneli Durdur
                        </button>

                        <button id="cf-retry-btn" onclick="checkCfConnection()" style="background: #e67e22; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: not-allowed; font-size: 0.85rem; font-weight: bold; text-align: left; display: flex; align-items: center; gap: 8px; opacity: 0.5;" disabled>
                            <span>🔄</span> Yenidən Cəhd
                        </button>
                        
                        <div style="height: 1px; background: #333; margin: 8px 0;"></div>
                        <div style="color: #888; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px;">Alətlər</div>
                        
                        <button onclick="runCfCommand('copy')" style="background: #444; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; text-align: left; display: flex; align-items: center; gap: 8px;">
                            <span>💾</span> Loqları Kopyala
                        </button>
                        
                        <button onclick="runCfCommand('clear')" style="background: #444; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; text-align: left; display: flex; align-items: center; gap: 8px;">
                            <span>🧹</span> Konsolu Təmizlə
                        </button>
                        
                        <div style="height: 1px; background: #333; margin: 8px 0;"></div>
                        
                        <button onclick="closeCloudflareModal(true)" style="background: #7f8c8d; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: bold; text-align: center;">
                            Bağla
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Setup input Enter key listener
        const terminalInput = document.getElementById('cf-terminal-input');
        terminalInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                const text = this.value.trim();
                if (text) {
                    const lowerText = text.toLowerCase();
                    if (lowerText === 'start' || lowerText === 'start-tunnel') {
                        runCfCommand('start');
                    } else if (lowerText === 'stop' || lowerText === 'stop-tunnel') {
                        runCfCommand('stop');
                    } else if (lowerText === 'logs' || lowerText === 'watch-logs') {
                        runCfCommand('logs');
                    } else if (lowerText === 'clear') {
                        runCfCommand('clear');
                    } else if (lowerText === 'copy') {
                        runCfCommand('copy');
                    } else {
                        appendCfLog(`\nubuntu@masterdeploy:~$ ${text}`, '#fff');
                        appendCfLog(`[MƏLUMAT] Əmr tapılmadı. Mövcud əmrlər: start, stop, logs, clear, copy`, '#ff9800');
                    }
                    this.value = '';
                }
            }
        });
    }

    showModal('cf-terminal-modal');

    const headerTitle = modal.querySelector('.win-title-text');
    if (headerTitle) {
        headerTitle.innerHTML = `
            ☁️ Cloudflare Tunnel: <span id="cf-app-name" style="color: #ff9800; font-weight: bold;">${appName}</span>
            <span id="cf-tunnel-url-container" style="font-size: 0.75rem; color: #ff9800; font-weight: bold; background: rgba(0, 0, 0, 0.4); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(255,152,0,0.2); margin-left: 10px;">Status: Hazır</span>
        `;
    }

    document.getElementById('cf-terminal-body').innerHTML = `
        <div style="color: #888;">[SİSTEM] Cloudflare tünel sessiyası başladı...</div>
        <div style="color: #888;">[SİSTEM] Uzaq serverlə bağlantı yoxlanılır...</div>
    `;
    setTimeout(checkCfConnection, 500);
}

async function checkCfConnection() {
    if (!currentCfAppId) return;

    setCfButtonsState(false, false);
    appendCfLog('[SİSTEM] Qoşulma yoxlanılır...', '#ff9800');

    try {
        const res = await fetch(`/api/plugins/cloudflare/logs/${currentCfAppId}`);
        if (res.ok) {
            appendCfLog('[SİSTEM] Uzaq serverlə əlaqə uğurla quruldu! Əmrlər aktivdir.', '#00e676');
            setCfButtonsState(true, false);
        } else {
            const err = await res.text();
            appendCfLog(`[XƏTA] Uzaq serverə qoşulmaq mümkün olmadı (Qoşulma uğursuz): ${err}`, '#ff1744');
            setCfButtonsState(false, true);
        }
    } catch (e) {
        appendCfLog(`[XƏTA] Şəbəkə və ya qoşulma xətası: ${e.message}`, '#ff1744');
        setCfButtonsState(false, true);
    }
}

function setCfButtonsState(commandsEnabled, retryEnabled) {
    const cmdBtns = ['cf-start-btn', 'cf-logs-btn', 'cf-stop-btn'];
    cmdBtns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = !commandsEnabled;
            btn.style.opacity = commandsEnabled ? '1' : '0.5';
            btn.style.cursor = commandsEnabled ? 'pointer' : 'not-allowed';
        }
    });

    const retryBtn = document.getElementById('cf-retry-btn');
    if (retryBtn) {
        retryBtn.disabled = !retryEnabled;
        retryBtn.style.opacity = retryEnabled ? '1' : '0.5';
        retryBtn.style.cursor = retryEnabled ? 'pointer' : 'not-allowed';
    }

    const input = document.getElementById('cf-terminal-input');
    if (input) {
        input.disabled = !commandsEnabled;
    }
}

async function closeCloudflareModal(shouldStop) {
    if (cfPollingInterval) {
        clearInterval(cfPollingInterval);
        cfPollingInterval = null;
    }
    closeModal('cf-terminal-modal');

    if (shouldStop && currentCfAppId) {
        try {
            await fetch(`/api/plugins/cloudflare/stop/${currentCfAppId}`, { method: 'POST' });
            addActivityLog("Cloudflare tuneli istifadəçi tərəfindən dayandırıldı", 'info');
        } catch (e) {
            console.error(e);
        }
        loadApplications();
    }
    currentCfAppId = null;
}

// Generate Cloudflare Tunnel
async function generateCloudflareTunnel(event, id) {
    if (event) event.stopPropagation();

    const appName = event ? (event.currentTarget.closest('.list-item') ? event.currentTarget.closest('.list-item').querySelector('h3').innerText.split('\n')[0].replace('🚀', '').trim() : id) : id;

    currentCfAppId = id;
    openCloudflareModal(id, appName);
}

async function runCfCommand(cmdType) {
    if (!currentCfAppId) return;

    if (cfPollingInterval) {
        clearInterval(cfPollingInterval);
        cfPollingInterval = null;
    }

    if (cmdType === 'start') {
        appendCfLog(`\nubuntu@masterdeploy:~$ start-tunnel`, '#fff');
        appendCfLog('[SİSTEM] Konteyner başladılır...', '#ff9800');
        document.getElementById('cf-tunnel-url-container').innerText = '🔗 Başladılır...';

        try {
            const res = await fetch(`/api/plugins/cloudflare/start/${currentCfAppId}`, { method: 'POST' });
            if (res.ok) {
                appendCfLog('[SİSTEM] Konteyner uğurla işə salındı! Canlı loqlar izlənilir...', '#00e676');
                startCfLogsPolling();
            } else {
                const err = await res.text();
                appendCfLog(`[XƏTA] Başlatma xətası: ${err}`, '#ff1744');
                document.getElementById('cf-tunnel-url-container').innerText = '❌ Xəta baş verdi';
            }
        } catch (e) {
            appendCfLog(`[SİSTEM XƏTASI] Qoşulma xətası: ${e.message}`, '#ff1744');
        }

    } else if (cmdType === 'logs') {
        appendCfLog(`\nubuntu@masterdeploy:~$ watch-logs`, '#fff');
        appendCfLog('[SİSTEM] Loq izləmə başladılır...', '#00e676');
        startCfLogsPolling();

    } else if (cmdType === 'stop') {
        appendCfLog(`\nubuntu@masterdeploy:~$ stop-tunnel`, '#fff');
        appendCfLog('[SİSTEM] Konteyner dayandırılır və silinir...', '#c0392b');
        document.getElementById('cf-tunnel-url-container').innerText = '🛑 Tünel dayandırıldı';

        try {
            const res = await fetch(`/api/plugins/cloudflare/stop/${currentCfAppId}`, { method: 'POST' });
            if (res.ok) {
                appendCfLog('[SİSTEM] Konteyner tamamilə dayandırıldı və silindi.', '#ff1744');
                loadApplications();
            } else {
                const err = await res.text();
                appendCfLog(`[XƏTA] Dayandırma xətası: ${err}`, '#ff1744');
            }
        } catch (e) {
            appendCfLog(`[SİSTEM XƏTASI] Qoşulma xətası: ${e.message}`, '#ff1744');
        }

    } else if (cmdType === 'clear') {
        document.getElementById('cf-terminal-body').innerHTML = '<div style="color: #888;">[SİSTEM] Terminal təmizləndi...</div>';

    } else if (cmdType === 'copy') {
        const text = document.getElementById('cf-terminal-body').innerText;
        navigator.clipboard.writeText(text).then(() => {
            appendCfLog('\n[SİSTEM] Bütün terminal mətnləri panoya kopyalandı.', '#00e676');
        }).catch(err => {
            appendCfLog('\n[XƏTA] Kopyalamaq mümkün olmadı: ' + err, '#ff1744');
        });
    }
}

function startCfLogsPolling() {
    if (cfPollingInterval) clearInterval(cfPollingInterval);

    let urlFound = false;
    cfPollingInterval = setInterval(async () => {
        if (!currentCfAppId) return;
        try {
            const logRes = await fetch(`/api/plugins/cloudflare/logs/${currentCfAppId}`);
            if (logRes.ok) {
                const data = await logRes.json();

                const termBody = document.getElementById('cf-terminal-body');
                termBody.innerText = data.logs;
                termBody.scrollTop = termBody.scrollHeight;

                if (data.cloudflare_url) {
                    document.getElementById('cf-tunnel-url-container').innerHTML = `
                        🔗 Link: <a href="${data.cloudflare_url}" target="_blank" style="color: #00e676; text-decoration: underline;">${data.cloudflare_url}</a>
                    `;
                    if (!urlFound) {
                        urlFound = true;
                        addActivityLog(`Cloudflare tunel linki alındı: ${data.cloudflare_url}`, 'success');
                    }
                }
            } else {
                // Log çəkmək alınmadı (məsələn SSH əlaqəsi qopdu)
                clearInterval(cfPollingInterval);
                cfPollingInterval = null;
                appendCfLog('\n[XƏTA] Uzaq serverlə əlaqə kəsildi (Loqlar oxunmadı).', '#ff1744');
                setCfButtonsState(false, true); // Yenidən Cəhd aktiv, digərləri disabled
            }
        } catch (e) {
            clearInterval(cfPollingInterval);
            cfPollingInterval = null;
            console.error("Logs polling failed", e);
            appendCfLog(`\n[XƏTA] Şəbəkə bağlantısı kəsildi: ${e.message}`, '#ff1744');
            setCfButtonsState(false, true);
        }
    }, 1500);
}

function appendCfLog(text, color = '#00e676') {
    const termBody = document.getElementById('cf-terminal-body');
    if (termBody) {
        const div = document.createElement('div');
        div.style.color = color;
        div.innerText = text;
        termBody.appendChild(div);
        termBody.scrollTop = termBody.scrollHeight;
    }
}
