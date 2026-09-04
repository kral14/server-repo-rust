// =====================================================
// applications.js — Layihə idarəetməsinin tam JS modulu
// Müstəqil overlay-lər və dinamik UI yeniləmələri
// =====================================================

function appShowOverlay(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = 'flex';
        const handler = (e) => {
            if (e.key === 'Escape') {
                appHideOverlay(id);
                document.removeEventListener('keydown', handler);
            }
        };
        document.addEventListener('keydown', handler);
    }
}

function appHideOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

async function loadApplications() {
    try {
        // Layihələri çəkməzdən əvvəl plugin statuslarını alırıq ki, installedPlugins dolsun
        try {
            const pRes = await fetch('/api/plugins');
            const plugins = await pRes.json();
            if (Array.isArray(plugins)) {
                plugins.forEach(p => {
                    installedPlugins[p.id] = p.installed;
                });
            }
        } catch (e) {
            console.error("Plugins fetch failed", e);
        }

        const [appRes, srvRes] = await Promise.all([
            fetch('/api/applications'),
            fetch('/api/servers')
        ]);

        let apps = [];
        if (appRes.ok) {
            try {
                apps = await appRes.json();
            } catch (err) {
                console.error("Failed to parse applications JSON:", err);
            }
        } else {
            console.warn("Failed to load applications, status:", appRes.status);
        }
        globalApps = Array.isArray(apps) ? apps : [];

        let servers = [];
        if (srvRes.ok) {
            try {
                servers = await srvRes.json();
            } catch (err) {
                console.error("Failed to parse servers JSON:", err);
            }
        } else {
            console.warn("Failed to load servers, status:", srvRes.status);
        }
        if (!Array.isArray(servers)) servers = [];

        const serverMap = {};
        const serverObjects = {};
        servers.forEach(s => {
            serverMap[s.id] = s.ip;
            serverObjects[s.id] = s;
        });

        const appsList = document.getElementById('apps-list');
        document.getElementById('stat-apps-count').innerText = globalApps.length;

        if (apps.length === 0) {
            appsList.innerHTML = `<div class="no-data">Hələ heç bir layihə əlavə edilməyib.</div>`;
            return;
        }

        // Group apps by server_id
        const groupedApps = {};
        apps.forEach(app => {
            const sid = app.server_id || 'unknown';
            if (!groupedApps[sid]) {
                groupedApps[sid] = [];
            }
            groupedApps[sid].push(app);
        });

        let html = '';
        for (const sid of Object.keys(groupedApps)) {
            const srv = serverObjects[sid];
            if (!srv) {
                // If server is deleted or does not exist in servers list, do not render its applications
                continue;
            }
            const srvName = srv.name;
            const srvIp = srv.ip;

            // Server Header
            html += `
            <div class="server-group" data-server-id="${sid}">
                <div class="server-group-header">
                    <h3>
                        🖥️ ${srvName} <span class="ip">(${srvIp})</span>
                    </h3>
                    <div class="server-group-header-info">
                        <span class="server-stats-badge" id="srv-stats-cpu-${sid}">
                            CPU: <strong>--</strong>
                        </span>
                        <span class="server-stats-badge" id="srv-stats-ram-${sid}">
                            RAM: <strong>-- / -- MB</strong>
                        </span>
                        <div class="server-header-actions">
                            <span class="server-action-link" onclick="goToServerSettings('${sid}')">⚙️ Sazlamalar</span>
                        </div>
                    </div>
                </div>
                <div class="server-apps-list" style="display:flex; flex-direction:column; gap:6px;">
            `;

            // Apps under this server
            groupedApps[sid].forEach(app => {
                const shortUrl = (app.repo_url || '').replace('https://github.com/', '').replace('https://', '');
                const statusColors = {
                    'running': '#00e676', 'success': '#00e676',
                    'failed': '#ff1744', 'deploying': '#00d2ff',
                    'building': '#00d2ff', 'cancelled': '#ff9800', 'idle': '#9aa0a6'
                };
                const sc = statusColors[app.status] || '#9aa0a6';
                const resolvedHost = (srvIp === 'local' || srvIp === '127.0.0.1') ? 'localhost' : srvIp;
                const apiLink = `http://${resolvedHost}:${app.port}`;

                const cached = serverStatsCache[sid];
                let cpuVal = '0%';
                let memVal = '0MB';
                if (cached && cached.containers && cached.containers[app.name]) {
                    const cstats = cached.containers[app.name];
                    cpuVal = cstats.cpu;
                    memVal = cstats.memory;
                }

                const appStatsHtml = `
                <span class="app-load-badge" data-app-name="${app.name}" id="app-load-${app.id}">
                    ⚡ CPU: <strong>${cpuVal}</strong> | 💾 RAM: <strong>${memVal}</strong>
                </span>
                `;


                const isCfInstalled = installedPlugins['cloudflare'] || false;

                html += `
                <div class="list-item" onclick="openAppDetails('${app.id}')" style="cursor: pointer; transition: all 0.2s ease; position: relative;">
                    <div class="item-info" style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1; min-width: 0;">
                            <h3 style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                <span style="display: inline-block; width: 200px; min-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${app.name}">🚀 ${app.name}</span>
                                ${app.status === 'success' || app.status === 'running' ? `
                                <a href="${apiLink}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: var(--accent-color); text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(0, 210, 255, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;">
                                    🔗 Lokal Keçid
                                </a>
                                ${app.cloudflare_url ? `
                                <a href="${app.cloudflare_url}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: #ff9800; text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(255, 152, 0, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;">
                                    ☁️ Cloudflare Keçidi
                                </a>
                                ` : ''}
                                ${app.cf_worker_url ? `
                                <a href="${app.cf_worker_url}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: #00e676; text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(0, 230, 118, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;" title="Sabit Worker Linki">
                                    🟢 Worker Linki
                                </a>
                                ` : ''}
                                ${isCfInstalled ? `
                                <button onclick="generateCloudflareTunnel(event, '${app.id}')" style="font-size: 0.75rem; color: #fff; background: #e67e22; border: none; border-radius: 4px; padding: 0.2rem 0.5rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem;" title="Cloudflare Tunelini İşə Sal / Link Al">
                                    🔄 ☁️ Tunnel Al
                                </button>
                                ` : ''}
                                ` : ''}
                                ${appStatsHtml}
                            </h3>
                            <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary); display: flex; gap: 1rem; align-items: center;">
                                <span style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${app.repo_url}">🐱 ${shortUrl} (${app.branch})</span>
                                <span>🔌 Port: <strong>${app.port}</strong></span>
                            </p>
                        </div>
                        <div style="display:flex; align-items:center; gap:0.8rem;">
                            <div style="display:inline-flex; align-items:center; gap:0.5rem; background: rgba(255,255,255,0.05); padding: 0.4rem 0.8rem; border-radius: 8px;">
                                <span style="width:8px; height:8px; border-radius:50%; background:${sc}; display:inline-block; box-shadow: 0 0 5px ${sc};"></span>
                                <span style="color:${sc}; font-weight:500;">${app.status.toUpperCase()}</span>
                            </div>
                            
                            <!-- 3 xətt menyusu -->
                            <div style="position: relative;">
                                <button class="app-menu-btn" onclick="toggleAppMenu(event, '${app.id}')">⋮</button>
                                <div id="app-menu-${app.id}" class="app-dropdown-menu">
                                    <button onclick="event.stopPropagation(); openAppDetails('${app.id}')">👁️ Detallara Bax</button>
                                    <button class="danger" onclick="event.stopPropagation(); deleteApp('${app.id}', '${app.name}')">🗑️ Sil</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                `;
            });

            html += `
                </div>
            </div>
            `;
        }

        appsList.innerHTML = html;

        // Immediately update stats UI with cache if populated
        updateStatsUI(servers);

        if (document.body.classList.contains('debug-mode')) {
            updateDebugDimensions();
        }
    } catch (e) {
        console.error("Failed to load applications", e);
    }
}


// Handle server creation
// --- Server CRUD & Setup JS Logic (Modularized in servers.js) ---
function toggleRepoSource(mode) {
    activeSourceMode = mode;
    const manualBtn = document.getElementById('src-manual-btn');
    const githubBtn = document.getElementById('src-github-btn');
    const manualInputs = document.getElementById('git-manual-inputs');
    const githubInputs = document.getElementById('git-github-inputs');

    if (mode === 'manual') {
        manualBtn.classList.add('active');
        githubBtn.classList.remove('active');
        manualInputs.style.display = 'block';
        githubInputs.style.display = 'none';
        document.getElementById('app-repo').required = true;
        document.getElementById('app-branch').required = true;
    } else {
        manualBtn.classList.remove('active');
        githubBtn.classList.add('active');
        manualInputs.style.display = 'none';
        githubInputs.style.display = 'block';
        document.getElementById('app-repo').required = false;
        document.getElementById('app-branch').required = false;

        const token = githubToken;
        if (token && gitHubRepos.length === 0) {
            loadGithubRepos();
        }
    }
}

// Handle application creation
async function handleCreateApp(event) {
    event.preventDefault();

    const deployType = document.getElementById('app-deploy-type').value;
    const registryImage = document.getElementById('app-registry-image').value.trim();
    let repoUrl = "";
    let branch = "";

    if (deployType === 'git') {
        if (activeSourceMode === 'manual') {
            repoUrl = document.getElementById('app-repo').value.trim();
            branch = document.getElementById('app-branch').value.trim();
        } else {
            const repoSelect = document.getElementById('app-repo-select');
            const selectedRepoName = repoSelect.value; // e.g. "owner/repo"
            if (!selectedRepoName) {
                alert("Lütfən bir repozitoriya seçin!");
                return;
            }

            branch = document.getElementById('app-branch-select').value;
            const token = githubToken;

            // Check if the selected repo is private
            const selectedOption = repoSelect.options[repoSelect.selectedIndex];
            const isPrivate = selectedOption.getAttribute('data-private') === 'true';

            if (isPrivate && token) {
                repoUrl = `https://${token}@github.com/${selectedRepoName}.git`;
            } else {
                repoUrl = `https://github.com/${selectedRepoName}.git`;
            }
        }
    }

    const keys = document.querySelectorAll('.env-key');
    const values = document.querySelectorAll('.env-value');
    let envVarsList = [];
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i].value.trim();
        const v = values[i].value.trim();
        if (k) {
            envVarsList.push(`${k}=${v}`);
        }
    }
    const envVarsString = envVarsList.join('\n');

    const server_id = document.getElementById('app-server').value;
    if (!server_id) {
        alert("Əvvəlcə 'Serverlər' bölməsindən server əlavə etməlisiniz!");
        return;
    }

    const memoryLimit = document.getElementById('app-memory').value.trim();
    const cpuLimit = document.getElementById('app-cpu').value.trim();

    const autoDeployEnabled = document.getElementById('app-autodeploy-enabled')?.checked ? 1 : 0;
    const autoDeployInterval = parseInt(document.getElementById('app-autodeploy-interval')?.value) || 15;
    const autoDeployTimeout = parseInt(document.getElementById('app-autodeploy-timeout')?.value) || 10;

    const payload = {
        name: document.getElementById('app-name').value.trim(),
        repo_url: repoUrl,
        branch: branch,
        port: parseInt(document.getElementById('app-port').value),
        server_id: server_id,
        env_vars: envVarsString,
        memory_limit: memoryLimit || null,
        cpu_limit: cpuLimit ? parseFloat(cpuLimit) : null,
        deploy_type: deployType,
        registry_image: registryImage || null,
        auto_deploy_enabled: autoDeployEnabled,
        auto_deploy_interval: autoDeployInterval,
        auto_deploy_timeout: autoDeployTimeout,
    };

    try {
        const res = await fetch('/api/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            appHideOverlay('app-overlay');
            document.getElementById('app-form').reset();
            resetEnvVarsContainer();
            toggleRepoSource('manual');
            addActivityLog(`Layihə yaradıldı: ${payload.name}`, 'app');
            loadApplications();
        } else {
            const errText = await res.text();
            addActivityLog(`Layihə yaratma uğursuz: ${payload.name}`, 'error');
            showInfoCard('❌ Xəta', 'Layihə yaranılmadı', errText);
        }
    } catch (e) {
        addActivityLog(`Layihə yaratma xətası`, 'error');
        console.error("Failed to create application", e);
    }
}

let currentActiveDeploymentId = null;
let logInterval = null;
let lastUpdateTime = null;
let lastSeenLog = '';
let updateBadgeTimer = null;

// Delete Application
async function deleteApp(appId, appName) {
    showConfirmCard({
        icon: '🗑️',
        title: 'Tətbiq Silinsin?',
        subtitle: appName,
        body: `<strong>DİQQƏT:</strong> Bu əməliyyat həm verilənlər bazasından, həm də uzaq serverdən (Docker container, kodlar) hər şeyi geri qaytarılmaz şəkildə siləcək.`,
        warning: '⚠️ Bu əməliyyat geri alına bilməz!',
        confirmText: '🗑️ Sil',
        confirmStyle: 'background: #ff1744; color: white;',
        onConfirm: async () => {
            // Ekranda standard modalı göstəririk
            appShowOverlay('app-delete-overlay');

            const termBody = document.getElementById('delete-terminal-body');
            termBody.innerHTML = ''; // Əvvəlki loqları təmizləyirik

            const addLog = (text, color = '#888') => {
                const div = document.createElement('div');
                div.style.color = color;
                div.textContent = text;
                termBody.appendChild(div);
                termBody.scrollTop = termBody.scrollHeight;
                
                if (!deletionLogsCache[appName]) {
                    deletionLogsCache[appName] = [];
                }
                deletionLogsCache[appName].push(text);
            };

            addLog(`[SİSTEM] Layihə silinməsi başladıldı: ${appName}...`);

            try {
                await new Promise(r => setTimeout(r, 600));
                addLog('[SİSTEM] Uzaq serverə SSH bağlantısı qurulur...', '#ff9800');
                
                await new Promise(r => setTimeout(r, 600));
                addLog(`[SİSTEM] Uzaq serverdə təmizləmə əmri arxa plana atılır: sudo docker rm -f ${appName} || true`, '#00e676');

                // API DELETE sorğusunu başladırıq
                const res = await fetch(`/api/applications/${appId}`, { method: 'DELETE' });
                
                if (res.ok) {
                    addLog('[SİSTEM] Server tərəfindəki docker konteynerinin silinməsi arxa planda işə salındı.', '#00e676');
                    await new Promise(r => setTimeout(r, 400));
                    addLog('[SİSTEM] Verilənlər bazasındakı tətbiq və deployment qeydləri silindi.', '#00e676');
                    
                    await new Promise(r => setTimeout(r, 400));
                    addLog('✅ Layihə uğurla silindi! İdarəetmə panelinə yönləndirilirsiniz...', '#00e676');
                    
                    addActivityLog(`Tətbiq silindi: ${appName}`, 'delete');
                    
                    await new Promise(r => setTimeout(r, 1200));
                    appHideOverlay('app-delete-overlay');
                    loadApplications();
                    switchTab('applications');
                } else {
                    const err = await res.text();
                    addLog(`❌ XƏTA: Server silmə sorğusunu tamamlaya bilmədi. Cavab: ${err}`, '#ff1744');
                    addActivityLog(`Tətbiq silmə uğursuz: ${appName}`, 'error');
                    
                    const closeBtn = document.createElement('button');
                    closeBtn.textContent = 'Bağla';
                    closeBtn.style.cssText = 'margin-top: 15px; background: #555; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;';
                    closeBtn.onclick = () => { appHideOverlay('app-delete-overlay'); };
                    termBody.appendChild(closeBtn);
                }
            } catch (e) {
                addLog(`❌ BAĞLANTI XƏTASI: Serverdən cavab alınmadı. Detal: ${e.message}`, '#ff1744');
                addActivityLog(`Tətbiq silmə xətası: ${appName}`, 'error');
                
                const closeBtn = document.createElement('button');
                closeBtn.textContent = 'Bağla';
                closeBtn.style.cssText = 'margin-top: 15px; background: #555; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;';
                closeBtn.onclick = () => { modal.style.display = 'none'; };
                termBody.appendChild(closeBtn);
            }
        }
    });
}

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

async function deployApp(id, noCache = true) {
    try {
        const appName = document.getElementById('detail-app-name') ? document.getElementById('detail-app-name').innerText : id;
        const url = noCache ? `/api/deploy/${id}?no_cache=true` : `/api/deploy/${id}`;
        const res = await fetch(url, { method: 'POST' });
        if (res.ok) {
            addActivityLog(`Deploy başladıldı: ${appName}`, 'deploy');
            loadApplications();
            viewLogs(id);
        } else {
            const errText = await res.text();
            addActivityLog(`Deploy uğursuz: ${appName}`, 'error');
            showInfoCard('❌ Xəta', 'Deploy başladıla bilmədi', errText);
        }
    } catch (e) {
        addActivityLog('Deploy xətası', 'error');
        showInfoCard('❌ Deploy Xətası', 'Serverdən cavab gəlmədi.', e.message);
    }
}

// Cancel Active Deployment
async function cancelActiveDeployment() {
    if (!currentActiveDeploymentId) return;
    showConfirmCard({
        icon: '🛑',
        title: 'Yayımı Ləğv Et?',
        subtitle: 'Cari deployment dayandırılacaq',
        body: 'Bu yayımı ləğv etmək istədiyinizdən əminsiniz?',
        confirmText: '🛑 Bəli, Ləğv Et',
        confirmStyle: 'background: #ff9100; color: white;',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/deploy/cancel/${currentActiveDeploymentId}`, { method: 'POST' });
                if (res.ok) {
                    const result = await res.json();
                    if (result) {
                        document.getElementById('cancel-deploy-btn').style.display = 'none';
                        document.getElementById('terminal-body').innerText += "\n[MƏLUMAT] Ləğv etmə sorğusu göndərildi...\n";
                        addActivityLog('Yayım ləğv edildi', 'delete');
                    }
                }
            } catch (e) {
                console.error("Failed to cancel deployment", e);
            }
        }
    });
}

// View Logs in Split-screen Tab (Koyeb-style)
function viewLogs(appId, switchMainTab = true, specificDeployId = null) {
    if (switchMainTab) { switchTab('app-details'); switchAppTab('logs'); }

    const terminal = document.getElementById('terminal-body');
    terminal.innerText = 'Yayım loqları yüklənir...';
    document.getElementById('cancel-deploy-btn').style.display = 'none';
    document.getElementById('stuck-warning-banner').style.display = 'none';
    document.getElementById('last-update-badge').innerText = '';
    document.getElementById('stream-status-dot').innerText = 'Loqlar yüklənir...';
    document.getElementById('stream-status-dot').style.color = '#ccc';
    currentActiveDeploymentId = null;
    currentAppId = appId;
    lastUpdateTime = Date.now();
    lastSeenLog = '';
    
    // Reset global deployment timing variables
    currentDeploymentCreatedAt = null;
    currentDeploymentStatus = null;

    // Reset all stages to pending on start
    document.querySelectorAll('.stage-item').forEach(el => {
        el.style.opacity = '0.4';
        el.style.color = 'var(--text-secondary)';
        el.querySelector('.stage-icon').innerHTML = '⚪';
        el.querySelector('.stage-time').innerText = '--';
    });

    // Default to showing Build content tab
    switchLogPanel('build');

    stopLogPolling();
    stopRuntimeLogPolling();

    // Əgər spesifik bir köhnə deployment loqu istənilibsə
    if (specificDeployId) {
        document.getElementById('stream-status-dot').innerText = 'Arxiv Loq (Statik)';
        document.getElementById('stream-status-dot').style.color = '#9aa0a6';
        if (updateBadgeTimer) { clearInterval(updateBadgeTimer); updateBadgeTimer = null; }

        fetch(`/api/deployments/single/${specificDeployId}`)
            .then(res => res.json())
            .then(deploy => {
                if (deploy) {
                    currentDeploymentCreatedAt = deploy.created_at;
                    currentDeploymentStatus = deploy.status;

                    terminal.innerHTML = deploy.logs ? formatLogsToHtml(deploy.logs) : "[MƏLUMAT] Bu deployment üçün loq tapılmadı.";
                    updateDeploymentStages(deploy.logs || '', deploy.status);
                    
                    const badge = document.getElementById('last-update-badge');
                    if (badge) {
                        badge.innerText = `Yayım bitib${getDeploymentTotalTime()}`;
                    }

                    const statusDot = document.getElementById('stream-status-dot');
                    if (statusDot) {
                        if (deploy.status === 'success') {
                            statusDot.innerText = 'Uğurlu (Arxiv) ✅';
                            statusDot.style.color = 'var(--success-color)';
                        } else if (deploy.status === 'stopped') {
                            statusDot.innerText = 'Dayandırılıb (Arxiv) ⚪';
                            statusDot.style.color = '#757575';
                        } else {
                            statusDot.innerText = `${deploy.status.toUpperCase()} (Arxiv) ❌`;
                            statusDot.style.color = 'var(--danger-color)';
                        }
                    }
                }
            })
            .catch(err => {
                console.error("Failed to fetch single deployment", err);
                terminal.innerText = "❌ Loqları yükləmək mümkün olmadı.";
            });
        return;
    }

    // Ticker to update "Last update: Xs ago" badge every second (Real-time polling üçün)

function parseSqliteUtcDate(sqliteStr) {
    if (!sqliteStr) return null;
    const isoStr = sqliteStr.trim().replace(" ", "T") + "Z";
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? null : d;
}

function getDeploymentTotalTime() {
    if (currentDeploymentCreatedAt) {
        const start = parseSqliteUtcDate(currentDeploymentCreatedAt);
        if (start) {
            let diffMs = 0;
            if (currentDeploymentStatus === 'building' || currentDeploymentStatus === 'deploying') {
                diffMs = Date.now() - start.getTime();
            } else {
                let totalSec = 0;
                document.querySelectorAll('.stage-item').forEach(el => {
                    const timeEl = el.querySelector('.stage-time');
                    if (!timeEl) return;
                    const txt = timeEl.innerText.trim();
                    if (txt === '--' || txt === 'Gedir...' || txt === 'Xəta' || txt === 'Ləğv edildi') return;
                    if (txt.includes('ms')) totalSec += parseFloat(txt) / 1000;
                    else if (txt.includes('m')) {
                        const parts = txt.split('m');
                        totalSec += (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
                    } else if (txt.includes('s')) totalSec += parseFloat(txt) || 0;
                });
                if (totalSec > 0) {
                    totalSec = Math.round(totalSec);
                    return totalSec >= 60 ? ` (Toplam vaxt: ${Math.floor(totalSec/60)}d ${totalSec%60}s)` : ` (Toplam vaxt: ${totalSec}s)`;
                }
                // Fallback: əgər bitibsə amma loqlar tam deyilsə (məs. ilk anlar)
                return '';
            }
            
            let totalSec = Math.max(0, Math.round(diffMs / 1000));
            if (totalSec >= 60) {
                const m = Math.floor(totalSec / 60);
                const s = totalSec % 60;
                return ` (Toplam vaxt: ${m}d ${s}s)`;
            }
            return ` (Toplam vaxt: ${totalSec}s)`;
        }
    }
    return '';
}

// Timer for update badge
function startUpdateBadgeTimer() {
    if (updateBadgeTimer) clearInterval(updateBadgeTimer);
    updateBadgeTimer = setInterval(() => {
        if (!lastUpdateTime) return;
        const secAgo = Math.floor((Date.now() - lastUpdateTime) / 1000);
        const badge = document.getElementById('last-update-badge');
        const stuckBanner = document.getElementById('stuck-warning-banner');
        if (badge) {
            badge.innerText = `Son yeniləmə: ${secAgo}s əvvəl${getDeploymentTotalTime()}`;
        }
        if (secAgo >= 180 && stuckBanner) {
            stuckBanner.style.display = 'block';
        } else if (stuckBanner) {
            stuckBanner.style.display = 'none';
        }
    }, 1000);
}

    startUpdateBadgeTimer();

    // Poll logs every 1 second
    logInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/deployments/${appId}`);
            const deployments = await res.json();
            if (deployments.length > 0) {
                const latest = deployments[0];
                currentDeploymentCreatedAt = latest.created_at;
                currentDeploymentStatus = latest.status;

                // Only update terminal if log has changed
                if (latest.logs !== lastSeenLog) {
                    const isNearBottom = lastSeenLog === '' || terminal.scrollHeight - terminal.scrollTop <= terminal.clientHeight + 50;
                    if (!latest.logs && (latest.status === 'failed' || latest.status === 'cancelled')) {
                        terminal.innerText = "[SERVER] Xəta baş verdi və ya yayım ləğv edildi. Loq tapılmadı.";
                    } else if (latest.logs) {
                        terminal.innerHTML = formatLogsToHtml(latest.logs);
                    }
                    if (isNearBottom) {
                        terminal.scrollTop = terminal.scrollHeight;
                    }
                    lastSeenLog = latest.logs;
                    lastUpdateTime = Date.now();
                    // Hide stuck banner when new logs arrive
                    const stuckBanner = document.getElementById('stuck-warning-banner');
                    if (stuckBanner) stuckBanner.style.display = 'none';
                }
                // Track deployment ID for cancelling
                currentActiveDeploymentId = latest.id;

                // Show/hide cancel button depending on deployment state
                if (latest.status === 'building' || latest.status === 'deploying') {
                    document.getElementById('cancel-deploy-btn').style.display = 'inline-block';
                } else {
                    document.getElementById('cancel-deploy-btn').style.display = 'none';
                }

                // Update UI stage indicators based on log contents
                updateDeploymentStages(latest.logs || '', latest.status);

                if (latest.status === 'success' || latest.status === 'failed' || latest.status === 'cancelled') {
                    stopLogPolling();
                    loadApplications();
                    document.getElementById('cancel-deploy-btn').style.display = 'none';
                    // Clear the update badge timer
                    if (updateBadgeTimer) { clearInterval(updateBadgeTimer); updateBadgeTimer = null; }
                    const badge = document.getElementById('last-update-badge');
                    const statusDot = document.getElementById('stream-status-dot');
                    const stuckBanner = document.getElementById('stuck-warning-banner');
                    if (stuckBanner) stuckBanner.style.display = 'none';
                    if (badge) {
                        badge.innerText = `Yayım tamamlandı${getDeploymentTotalTime()}`;
                    }
                    if (statusDot) {
                        if (latest.status === 'success') {
                            statusDot.innerText = 'Tamamlandı ✅';
                            statusDot.style.color = 'var(--success-color)';
                            const linkBtn = document.getElementById('deploy-app-link-btn');
                            if (linkBtn) linkBtn.style.display = 'inline-block';
                            
                            // Build uğurlu olduqdan sonra avtomatik olaraq Canlı Server loqlarına keçid edirik
                            switchLogPanel('live');
                        } else {
                            statusDot.innerText = 'Dayandırıldı ❌';
                            statusDot.style.color = 'var(--danger-color)';
                        }
                    }
                    if (latest.status === 'cancelled') {
                        // Mark stages as red/danger style
                        document.querySelectorAll('.stage-item').forEach(el => {
                            const iconEl = el.querySelector('.stage-icon');
                            if (iconEl.innerHTML.includes('🔄') || iconEl.innerHTML === '⚪') {
                                el.style.opacity = '1.0';
                                el.style.color = '#ff1744';
                                iconEl.innerHTML = '❌';
                                el.querySelector('.stage-time').innerText = 'Ləğv edildi';
                            }
                        });
                    }
                }
            }
        } catch (e) {
            console.error("Error polling logs", e);
        }
    }, 1000);
}

// Helper to remove ANSI color codes and corrupted characters from logs
function stripAnsi(str) {
    if (!str) return '';
    // Strip standard ANSI codes
    let stripped = str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    // Also remove any literal "[0m", "[32m", "[2m" strings that sometimes appear unparsed
    stripped = stripped.replace(/\[\d+m/g, '');
    return stripped;
}

// Convert logs to HTML with error, success, and warning lines highlighted
function formatLogsToHtml(rawLogs) {
    if (!rawLogs) return '';
    const cleanLogs = stripAnsi(rawLogs);
    const lines = cleanLogs.split('\n');
    const formattedLines = lines.map(line => {
        let escapedLine = line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const isError = /\[error\]|error|failed|xəta|fail|stderr|critical|cannot|could not|failed to/i.test(escapedLine);
        const isSuccess = /\[success\]|success|successfully|yazıldı|deploy olundu|succeeded/i.test(escapedLine);
        const isWarning = /\[warning\]|warning|uyarı/i.test(escapedLine);

        if (isError) {
            return `<span style="color: #ff1744; font-weight: 500;">${escapedLine}</span>`;
        } else if (isSuccess) {
            return `<span style="color: #00e676; font-weight: 500;">${escapedLine}</span>`;
        } else if (isWarning) {
            return `<span style="color: #ffaa00; font-weight: 500;">${escapedLine}</span>`;
        }
        return escapedLine;
    });
    return formattedLines.join('\n');
}

// Koyeb-style stage parser based on log keywords
function updateDeploymentStages(logText, deployStatus = null) {
    const stages = [
        {
            id: 'stage-1',
            startPattern: 'Connecting to server',
            endPattern: '[SUCCESS] Workspace directory created',
            errorPattern: '[ERROR] Directory prep failed',
            pendingDesc: 'Uzaq server hazırlanır...',
            successDesc: 'Uzaq server hazırlandı',
            failedDesc: 'Hazırlıq alınmadı',
            defaultTime: '2s'
        },
        {
            id: 'stage-2',
            startPattern: '[2/5] Git repository',
            endPattern: '[SUCCESS] Repository cloned',
            errorPattern: '[ERROR] Git checkout failed',
            pendingDesc: 'Git repozitoriya klonlanır...',
            successDesc: 'Repozitoriya uğurla klonlandı',
            failedDesc: 'Klonlama alınmadı',
            defaultTime: '2s'
        },
        {
            id: 'stage-3',
            startPattern: '[3/5] Docker image build',
            endPattern: '[SUCCESS] Docker image',
            errorPattern: '[ERROR] Docker build failed',
            pendingDesc: 'Docker imici yığılır...',
            successDesc: 'Docker imici yığıldı',
            failedDesc: 'Build uğursuz oldu',
            getTime: (text) => {
                // Docker build done saniyəsini axtarır (məs: DONE 8.9s və ya DONE 129s)
                const match = text.match(/DONE\s+([\d.]+(?:s|ms))/i);
                return match ? match[1] : '93s';
            }
        },
        {
            id: 'stage-4',
            startPattern: '[4/5]',
            endPattern: '[5/5]',
            errorPattern: null,
            pendingDesc: 'Köhnə konteynerlər silinir...',
            successDesc: 'Köhnə konteynerlər təmizləndi',
            failedDesc: 'Təmizlik alınmadı',
            defaultTime: '1s'
        },
        {
            id: 'stage-5',
            startPattern: '[5/5] Yeni konteyner',
            endPattern: '[SUCCESS] T', // matches Tətbiq or TЙ™tbiq
            errorPattern: '[ERROR] Docker run command failed',
            pendingDesc: 'Yeni konteyner başladılır...',
            successDesc: 'Tətbiq uğurla işə salındı',
            failedDesc: 'Başlatmaq alınmadı',
            defaultTime: '1s'
        }
    ];

    let anyFailed = false;

    stages.forEach((stage) => {
        const el = document.getElementById(stage.id);
        if (!el) return;

        const iconEl = el.querySelector('.stage-icon');
        const descEl = el.querySelector('.stage-desc');
        const timeEl = el.querySelector('.stage-time');

        const hasStarted = logText.includes(stage.startPattern);
        const hasEnded = logText.includes(stage.endPattern);
        const hasFailed = stage.errorPattern ? logText.includes(stage.errorPattern) : false;
        const isGlobalFailed = deployStatus === 'failed' || deployStatus === 'cancelled';

        if (hasFailed || anyFailed || (isGlobalFailed && !hasEnded)) {
            el.style.opacity = '1.0';
            el.style.color = '#ff1744'; // danger color
            iconEl.innerHTML = '❌';
            if (descEl) descEl.innerText = stage.failedDesc;
            timeEl.innerText = 'Xəta';
            anyFailed = true;
        } else if (hasEnded) {
            el.style.opacity = '1.0';
            el.style.color = '#00e676'; // success color
            iconEl.innerHTML = '✅';
            if (descEl) descEl.innerText = stage.successDesc;

            // Vaxtı təyin etmək
            if (stage.getTime) {
                timeEl.innerText = stage.getTime(logText);
            } else {
                timeEl.innerText = stage.defaultTime;
            }
        } else if (hasStarted) {
            el.style.opacity = '1.0';
            el.style.color = '#00d2ff'; // accent color
            iconEl.innerHTML = '<span class="spin-icon">🔄</span>';
            if (descEl) descEl.innerText = stage.pendingDesc;
            timeEl.innerText = 'Gedir...';
        } else {
            el.style.opacity = '0.4';
            el.style.color = 'var(--text-secondary)';
            iconEl.innerHTML = '⚪';
            if (descEl) descEl.innerText = 'Gözlənilir';
            timeEl.innerText = '--';
        }
    });
}

function stopLogPolling() {
    if (logInterval) {
        clearInterval(logInterval);
        logInterval = null;
    }
}

// ============================================================
// App Settings Modal Functions
// ============================================================

let currentSettingsAppId = null;


async function openAppSettings(appId, showModalBool = true) {
    currentSettingsAppId = appId;
    try {
        const res = await fetch(`/api/applications/${appId}`);
        if (!res.ok) { alert('Layihə məlumatları yüklənmədi.'); return; }
        const app = await res.json();

        if (githubToken && gitHubRepos.length === 0) {
            await loadGithubRepos();
        }

        const nameLabel = document.getElementById('settings-app-name-label');
        if (nameLabel) nameLabel.innerText = `🚀 ${app.name}`;

        document.getElementById('settings-repo-url').value = app.repo_url || '';
        
        let repoNameOnly = '';
        if (app.repo_url) {
            repoNameOnly = app.repo_url.replace('https://github.com/', '').replace('https://', '');
            if (repoNameOnly.endsWith('.git')) {
                repoNameOnly = repoNameOnly.slice(0, -4);
            }
        }
        const searchInput = document.getElementById('settings-repo-search');
        if (searchInput) {
            searchInput.value = repoNameOnly || '';
        }

        document.getElementById('settings-branch').value = app.branch || 'main';
        document.getElementById('settings-port').value = app.port || 8080;
        populateSettingsEnvVars(app.env_vars || '');
        document.getElementById('settings-build-command').value = app.build_command || '';
        document.getElementById('settings-run-command').value = app.run_command || '';
        document.getElementById('settings-dockerfile-path').value = app.dockerfile_path || '';
        document.getElementById('settings-entrypoint').value = app.entrypoint || '';
        document.getElementById('settings-command').value = app.command || '';
        const workDirEl = document.getElementById('settings-work-dir');
        if (workDirEl) workDirEl.value = app.work_dir || '';
        document.getElementById('settings-memory-limit').value = app.memory_limit || '';
        document.getElementById('settings-cpu-limit').value = app.cpu_limit || '';
        const cfWorkerUrlEl = document.getElementById('settings-cf-worker-url');
        if (cfWorkerUrlEl) cfWorkerUrlEl.value = app.cf_worker_url || '';

        const depType = app.deploy_type || 'git';
        const regImg = app.registry_image || '';
        const depTypeEl = document.getElementById('settings-deploy-type');
        if (depTypeEl) {
            depTypeEl.value = depType;
            toggleDeployTypeFields('settings');
        }
        const regImgEl = document.getElementById('settings-registry-image');
        if (regImgEl) regImgEl.value = regImg;

        // Auto-Deploy Fields
        const autoEnabledEl = document.getElementById('settings-autodeploy-enabled');
        if (autoEnabledEl) {
            autoEnabledEl.checked = app.auto_deploy_enabled === 1;
        }
        const autoIntervalEl = document.getElementById('settings-autodeploy-interval');
        if (autoIntervalEl) {
            autoIntervalEl.value = app.auto_deploy_interval != null ? String(app.auto_deploy_interval) : '15';
        }
        const autoTimeoutEl = document.getElementById('settings-autodeploy-timeout');
        if (autoTimeoutEl) {
            autoTimeoutEl.value = app.auto_deploy_timeout != null ? String(app.auto_deploy_timeout) : '10';
        }

        const bpt = app.build_pack_type || 'dockerfile';
        settingsSelectBuild(bpt);

        if (showModalBool) showModal('app-settings-modal');
    } catch (e) {
        console.error('openAppSettings error', e);
    }
}

function settingsSelectBuild(type) {
    const bpBtn = document.getElementById('settings-bp-btn');
    const dfBtn = document.getElementById('settings-df-btn');
    const bpFields = document.getElementById('settings-bp-fields');
    const dfFields = document.getElementById('settings-df-fields');

    if (type === 'buildpack') {
        settingsCurrentBuildType = 'buildpack';
        bpBtn.classList.add('active');
        bpBtn.style.background = 'rgba(0,210,255,0.1)';
        bpBtn.style.color = 'var(--accent-color)';
        dfBtn.classList.remove('active');
        dfBtn.style.background = 'transparent';
        dfBtn.style.color = 'var(--text-secondary)';
        bpFields.style.display = 'block';
        dfFields.style.display = 'none';
    } else {
        settingsCurrentBuildType = 'dockerfile';
        dfBtn.classList.add('active');
        dfBtn.style.background = 'rgba(0,210,255,0.1)';
        dfBtn.style.color = 'var(--accent-color)';
        bpBtn.classList.remove('active');
        bpBtn.style.background = 'transparent';
        bpBtn.style.color = 'var(--text-secondary)';
        bpFields.style.display = 'none';
        dfFields.style.display = 'block';
    }
}

let settingsCurrentBuildType = 'dockerfile';

function buildSettingsPayload() {
    return {
        repo_url: document.getElementById('settings-repo-url').value.trim() || "",
        branch: document.getElementById('settings-branch').value.trim() || "",
        port: parseInt(document.getElementById('settings-port').value) || null,
        env_vars: getSettingsEnvVarsString() || null,
        build_pack_type: settingsCurrentBuildType,
        build_command: document.getElementById('settings-build-command').value.trim() || null,
        run_command: document.getElementById('settings-run-command').value.trim() || null,
        dockerfile_path: document.getElementById('settings-dockerfile-path').value.trim() || null,
        entrypoint: document.getElementById('settings-entrypoint').value.trim() || null,
        command: document.getElementById('settings-command').value.trim() || null,
        work_dir: document.getElementById('settings-work-dir').value.trim() || null,
        memory_limit: document.getElementById('settings-memory-limit').value.trim() || null,
        cpu_limit: parseFloat(document.getElementById('settings-cpu-limit').value.trim()) || null,
        cf_worker_url: document.getElementById('settings-cf-worker-url').value.trim() || null,
        deploy_type: document.getElementById('settings-deploy-type').value,
        registry_image: document.getElementById('settings-registry-image').value.trim() || null,
        auto_deploy_enabled: document.getElementById('settings-autodeploy-enabled')?.checked ? 1 : 0,
        auto_deploy_interval: parseInt(document.getElementById('settings-autodeploy-interval')?.value) || 15,
        auto_deploy_timeout: parseInt(document.getElementById('settings-autodeploy-timeout')?.value) || 10,
    };
}



async function saveAppSettings() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) {
        alert("Layihə seçilməyib!");
        return;
    }
    const payload = buildSettingsPayload();
    try {
        const res = await fetch(`/api/applications/${appId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            alert('Ayarlar uğurla yadda saxlanıldı!');
            loadApplications();
            // Pending redeploy bayrağını qoy
            localStorage.setItem(`pending_redeploy_${appId}`, 'true');
            markRedeployPending(true);
        } else {
            const err = await res.text();
            alert('Yadda saxlamaqda xəta: ' + err);
        }
    } catch (e) {
        console.error('saveAppSettings error', e);
        alert('Serverlə əlaqə xətası: ' + e);
    }
}

async function redeployApp() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) {
        alert("Layihə seçilməyib!");
        return;
    }
    // Pending redeploy bayrağını sıfırla
    localStorage.removeItem(`pending_redeploy_${appId}`);
    markRedeployPending(false);
    deployApp(appId, true); // no_cache=true → tam təmiz yığım
}

async function cacheDeployApp() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) {
        alert("Layihə seçilməyib!");
        return;
    }
    localStorage.removeItem(`pending_redeploy_${appId}`);
    markRedeployPending(false);
    deployApp(appId, false); // no_cache=false → Docker keşini istifadə edir (sürətli)
}

// Redeploy düyməsinə pending sinifini əlavə et / sil
function markRedeployPending(isPending) {
    const btn = document.getElementById('btn-app-redeploy');
    if (!btn) return;
    if (isPending) {
        btn.classList.add('pending-redeploy');
    } else {
        btn.classList.remove('pending-redeploy');
    }
}

async function stopApp() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) return;
    const btn = document.getElementById('btn-app-stop');
    const orig = btn.innerText;
    btn.innerText = '⏳ Dayandırılır...';
    btn.disabled = true;
    try {
        const res = await fetch(`/api/applications/${appId}/stop`, { method: 'POST' });
        if (res.ok) {
            alert('Layihə uğurla dayandırıldı!');
            loadApplications();
            if (typeof openAppDetails === 'function') openAppDetails(appId);
        } else {
            const err = await res.text();
            alert('Dayandırmaqda xəta: ' + err);
        }
    } catch (e) {
        alert('Serverlə əlaqə xətası: ' + e);
    } finally {
        btn.innerText = orig;
        btn.disabled = false;
    }
}

async function restartApp() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) return;
    const btn = document.getElementById('btn-app-restart');
    const orig = btn.innerText;
    btn.innerText = '⏳ Yenidən başladılır...';
    btn.disabled = true;
    try {
        const res = await fetch(`/api/applications/${appId}/restart`, { method: 'POST' });
        if (res.ok) {
            alert('Layihə uğurla yenidən başladıldı!');
            loadApplications();
            if (typeof openAppDetails === 'function') openAppDetails(appId);
        } else {
            const err = await res.text();
            alert('Yenidən başlatmaqda xəta: ' + err);
        }
    } catch (e) {
        alert('Serverlə əlaqə xətası: ' + e);
    } finally {
        btn.innerText = orig;
        btn.disabled = false;
    }
}


// Copy terminal logs to clipboard
function copyTerminalLogs() {
    const terminal = document.getElementById('terminal-body');
    const text = terminal.innerText || terminal.textContent || '';
    if (!text.trim()) return;

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copy-logs-btn');
        if (btn) {
            const orig = btn.innerText;
            btn.innerText = 'Kopyalandı!';
            setTimeout(() => { btn.innerText = orig; }, 2000);
        }
    });
}


async function loadWizServers() {
    try {
        const res = await fetch('/api/servers');
        const servers = await res.json();
        const serverSelect = document.getElementById('wiz-app-server');

        if (servers.length === 0) {
            serverSelect.innerHTML = `<option value="">Öncə server əlavə edin</option>`;
            return;
        }

        serverSelect.innerHTML = servers.map(s => `<option value="${s.id}">${s.name} (${s.ip})</option>`).join('');
    } catch (e) {
        console.error(e);
    }
}

function goBackFromConfig() {
    if (wizSelectedSource === 'docker') {
        goToStep(1);
    } else {
        goToStep(3);
    }
}

// Wizard ENV Builder helper functions
function addWizEnvVarRow(key = '', val = '') {
    const container = document.getElementById('wiz-env-vars-container');
    const row = document.createElement('div');
    row.className = 'wiz-env-var-row';
    row.style.display = 'flex';
    row.style.gap = '0.5rem';
    row.style.marginBottom = '0.5rem';
    row.style.alignItems = 'center';

    row.innerHTML = `
        <input type="text" placeholder="Açar (Key)" class="wiz-env-key" value="${key}" style="flex: 1; padding: 0.6rem 0.8rem; font-size: 0.85rem;" required>
        <input type="text" placeholder="Dəyər (Value)" class="wiz-env-value" value="${val}" style="flex: 2; padding: 0.6rem 0.8rem; font-size: 0.85rem;" required>
        <button type="button" onclick="this.parentElement.remove()" style="background: transparent; border: none; color: var(--danger-color); font-size: 1.2rem; cursor: pointer; padding: 0 0.5rem;">✕</button>
    `;
    container.appendChild(row);
}

function resetWizEnvVarsContainer() {
    const container = document.getElementById('wiz-env-vars-container');
    if (container) {
        container.innerHTML = '';
        addWizEnvVarRow(); // Add one default empty row
    }
}

// Final Deploy Trigger from Wizard
async function handleWizardDeploy(event) {
    event.preventDefault();

    let repoUrl = "";
    let branch = "";
    const deployType = document.getElementById('wiz-deploy-type').value;
    const registryImage = document.getElementById('wiz-registry-image').value.trim();

    if (deployType === 'git') {
        if (wizSelectedRepo.isDocker) {
            repoUrl = "DOCKER_IMAGE:" + document.getElementById('wiz-app-name').value.trim();
            branch = "latest";
        } else if (wizSelectedRepo.manualUrl) {
            repoUrl = wizSelectedRepo.manualUrl;
            branch = document.getElementById('wiz-app-branch').value;
        } else {
            const token = githubToken;
            if (wizSelectedRepo.private && token) {
                repoUrl = `https://${token}@github.com/${wizSelectedRepo.full_name}.git`;
            } else {
                repoUrl = `https://github.com/${wizSelectedRepo.full_name}.git`;
            }
            branch = document.getElementById('wiz-app-branch').value;
        }
    }

    // Build ENV vars string
    const keys = document.querySelectorAll('.wiz-env-key');
    const values = document.querySelectorAll('.wiz-env-value');
    let envVarsList = [];
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i].value.trim();
        const v = values[i].value.trim();
        if (k) {
            envVarsList.push(`${k}=${v}`);
        }
    }
    const envVarsString = envVarsList.join('\n');

    const buildPackType = wizSelectedBuildOption || 'dockerfile';
    let buildCommand = null;
    let runCommand = null;
    let dockerfilePath = null;
    let entrypoint = null;
    let command = null;
    let target = null;
    let workDir = null;
    let privileged = 0;

    if (buildPackType === 'buildpack') {
        buildCommand = document.getElementById('wiz-bp-build-command').value.trim() || null;
        runCommand = document.getElementById('wiz-bp-run-command').value.trim() || null;
        workDir = document.getElementById('wiz-bp-work-dir').value.trim() || null;
        privileged = document.getElementById('wiz-bp-privileged').checked ? 1 : 0;
    } else {
        dockerfilePath = document.getElementById('wiz-df-path').value.trim() || null;
        entrypoint = document.getElementById('wiz-df-entrypoint').value.trim() || null;
        command = document.getElementById('wiz-df-command').value.trim() || null;
        target = document.getElementById('wiz-df-target').value.trim() || null;
        workDir = document.getElementById('wiz-df-work-dir').value.trim() || null;
        privileged = document.getElementById('wiz-df-privileged').checked ? 1 : 0;
    }

    const memoryLimit = document.getElementById('wiz-app-memory').value.trim();
    const cpuLimit = document.getElementById('wiz-app-cpu').value.trim();

    const payload = {
        name: document.getElementById('wiz-app-name').value.trim(),
        repo_url: repoUrl,
        branch: branch,
        port: parseInt(document.getElementById('wiz-app-port').value),
        server_id: document.getElementById('wiz-app-server').value,
        env_vars: envVarsString,
        build_pack_type: buildPackType,
        build_command: buildCommand,
        run_command: runCommand,
        dockerfile_path: dockerfilePath,
        entrypoint: entrypoint,
        command: command,
        target: target,
        work_dir: workDir,
        privileged: privileged,
        memory_limit: memoryLimit || null,
        cpu_limit: cpuLimit ? parseFloat(cpuLimit) : null,
        deploy_type: deployType,
        registry_image: registryImage || null,
    };

    try {
        const res = await fetch('/api/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const app = await res.json();
            appHideOverlay('app-wizard-overlay');
            loadApplications();
            // Trigger deployment immediately!
            deployApp(app.id);
        } else {
            const errText = await res.text();
            alert("Xəta baş verdi: " + errText);
        }
    } catch (e) {
        console.error("Wizard deploy failed", e);
    }
}

// Layout Spacing Debugger
function toggleDebugMode() {
    document.body.classList.toggle('debug-mode');
    updateDebugDimensions();
}

function updateDebugDimensions() {
    // Clear old dimensions attributes
    document.querySelectorAll('[data-dimensions]').forEach(el => {
        el.removeAttribute('data-dimensions');
    });

    if (!document.body.classList.contains('debug-mode')) {
        return;
    }

    // Select all visible elements, labels, buttons, spans, headers, and tabs on screen, excluding layout and ambient elements
    const targets = document.querySelectorAll(
        'body.debug-mode *:not(script):not(style):not(.status-indicator):not(br):not(span.logo-icon):not(.ambient-glow):not(.app-container):not(.sidebar):not(.main-content):not(.modal-backdrop):not(.modal-card):not(.tab-section)'
    );

    targets.forEach(el => {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        // Only mark elements that have actual layout dimensions
        if (w > 2 && h > 2) {
            el.setAttribute('data-dimensions', `${w}px × ${h}px`);
        }
    });
}

// Keep sizes updated on window resize
window.addEventListener('resize', () => {
    if (document.body.classList.contains('debug-mode')) {
        updateDebugDimensions();
    }
});

// Server Stats fetching logic
let serverStatsCache = {};

async function fetchServerStats() {
    if (!document.getElementById('tab-applications').classList.contains('active')) {
        setTimeout(fetchServerStats, 10000);
        return;
    }

    try {
        const res = await fetch('/api/servers');
        if (!res.ok) throw new Error("Failed to fetch servers list");
        const servers = await res.json();

        await Promise.all(servers.map(async (server) => {
            try {
                const statsRes = await fetch(`/api/servers/${server.id}/stats`);
                if (statsRes.ok) {
                    const stats = await statsRes.json();
                    serverStatsCache[server.id] = stats;
                }
            } catch (e) {
                console.error(`Failed to fetch stats for server ${server.id}:`, e);
            }
        }));

        updateStatsUI(servers);
    } catch (e) {
        console.error("Failed to fetch server stats in loop:", e);
    }

    setTimeout(fetchServerStats, 10000);
}

function updateStatsUI(servers) {
    if (!Array.isArray(servers)) return;

    servers.forEach(server => {
        const stats = serverStatsCache[server.id];
        if (!stats) return;

        // Auto-update server status badge to connected if metrics respond
        const statusEl = document.getElementById(`status-${server.id}`);
        if (statusEl && (stats.total_ram_mb > 0 || stats.cores > 0)) {
            statusEl.innerHTML = `Qoşulub ✅`;
            statusEl.style.color = '#00e676';
            statusEl.style.background = 'rgba(0, 230, 118, 0.1)';
        }

        // Update CPU badge
        const cpuEl = document.getElementById(`srv-stats-cpu-${server.id}`);
        if (cpuEl) {
            cpuEl.innerHTML = `CPU: <strong>${stats.cores} Nüvə</strong>`;
        }

        // Update RAM badge
        const ramEl = document.getElementById(`srv-stats-ram-${server.id}`);
        if (ramEl) {
            ramEl.innerHTML = `RAM: <strong>${stats.used_ram_mb} / ${stats.total_ram_mb} MB</strong>`;

            const ramPercent = stats.used_ram_mb / stats.total_ram_mb;
            if (ramPercent > 0.85) {
                ramEl.style.color = '#ff1744'; // Red
            } else if (ramPercent > 0.6) {
                ramEl.style.color = '#ffb300'; // Orange
            } else {
                ramEl.style.color = '#00e676'; // Green
            }
        }

        // Update individual application badges under this server
        const srvGroup = document.querySelector(`.server-group[data-server-id="${server.id}"]`);
        if (srvGroup) {
            const badges = srvGroup.querySelectorAll(`.app-load-badge`);
            badges.forEach(badge => {
                badge.innerHTML = `⚡ CPU: <strong>0%</strong> | 💾 RAM: <strong>0MB</strong>`;
            });
        }

        if (stats.containers) {
            Object.keys(stats.containers).forEach(appName => {
                const cstats = stats.containers[appName];
                const badges = document.querySelectorAll(`.app-load-badge[data-app-name="${appName}"]`);
                badges.forEach(badge => {
                    badge.innerHTML = `⚡ CPU: <strong>${cstats.cpu}</strong> | 💾 RAM: <strong>${cstats.memory}</strong>`;
                });
            });
        }

    });
}

function goToServerSettings(serverId) {
    if (event) event.stopPropagation();
    switchTab('servers');
    editServer(serverId);
}


// Accordion toggle logic
function toggleAccordion(contentId, headerElement) {
    const content = document.getElementById(contentId);
    const icon = headerElement.querySelector('.accordion-icon');

    // Check if the clicked one is currently closed
    const isClosed = content.style.display === 'none';

    // Close all accordions first
    document.querySelectorAll('.accordion-content').forEach(el => {
        el.style.display = 'none';
    });
    document.querySelectorAll('.accordion-icon').forEach(el => {
        if (el.classList.contains('toggle-text-btn')) {
            el.innerText = 'Göstər';
            el.style.background = 'rgba(255,255,255,0.1)';
        } else {
            el.style.transform = 'rotate(0deg)';
        }
    });

    // If it was closed, open it. Otherwise, it stays closed (toggle behavior)
    if (isClosed) {
        content.style.display = 'flex';
        if (icon.classList.contains('toggle-text-btn')) {
            icon.innerText = 'Gizlət';
            icon.style.background = 'var(--accent-color)';
        } else {
            icon.style.transform = 'rotate(180deg)';
        }
    }
}

// Switch Log Panels (Build vs Live)
function switchLogPanel(panelId) {
    const buildBtn = document.getElementById('btn-show-build');
    const liveBtn = document.getElementById('btn-show-live');
    const buildCont = document.getElementById('build-content');
    const liveCont = document.getElementById('live-content');

    if (!buildBtn || !liveBtn || !buildCont || !liveCont) return;

    if (panelId === 'build') {
        buildBtn.classList.add('active');
        liveBtn.classList.remove('active');
        buildCont.style.display = 'flex';
        liveCont.style.display = 'none';
        stopRuntimeLogPolling();
    } else {
        liveBtn.classList.add('active');
        buildBtn.classList.remove('active');
        buildCont.style.display = 'none';
        liveCont.style.display = 'flex';
        if (currentAppId) {
            stopRuntimeLogPolling();
            fetchRuntimeLogs(currentAppId);
        }
    }


}

// Auto-fill and advisor for Server Stats
async function updateServerStatsAdvisor(selectId, advisorDivId, memInputId, cpuInputId) {
    const serverId = document.getElementById(selectId).value;
    const advisorDiv = document.getElementById(advisorDivId);

    if (!serverId) {
        advisorDiv.style.display = 'none';
        return;
    }

    advisorDiv.style.display = 'block';
    advisorDiv.innerHTML = '⏳ Serverin boş resursları yoxlanılır...';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`/api/servers/${serverId}/stats`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error("Stats fetch failed");
        const stats = await res.json();

        const freeRam = stats.total_ram_mb - stats.used_ram_mb;
        const freeCores = stats.cores;

        let recommendedRam = '256m';
        if (freeRam > 1000) recommendedRam = '512m';
        if (freeRam > 2000) recommendedRam = '1g';

        let recommendedCpu = '0.5';
        if (freeCores >= 2) recommendedCpu = '1';

        advisorDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
                <div>
                    <strong style="color: #fff; display: block; margin-bottom: 0.5rem;">📊 Serverin Cari Vəziyyəti:</strong>
                    <div style="margin-bottom: 0.3rem;">• Boş RAM: <strong style="color: var(--success-color);">${freeRam} MB</strong> (Cəmi: ${stats.total_ram_mb} MB)</div>
                    <div>• Nüvə Sayı: <strong>${stats.cores} Core</strong></div>
                    <div style="margin-top: 0.5rem; color: #94a3b8;">Tövsiyə olunan minimal limitlər: <strong>${recommendedRam}</strong> RAM, <strong>${recommendedCpu}</strong> CPU</div>
                </div>
                <button type="button" class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.75rem; border: 1px solid var(--accent-color); color: var(--accent-color);" onclick="
                    document.getElementById('${memInputId}').value = '${recommendedRam}';
                    document.getElementById('${cpuInputId}').value = '${recommendedCpu}';
                ">Tövsiyəni Tətbiq Et</button>
            </div>
        `;
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(e);
        }
        advisorDiv.innerHTML = '⚠️ Server məlumatları alına bilmədi (Gözləmə vaxtı bitdi). Serverin aktiv olduğuna əmin olun.';
    }
}
let runtimeLogTimeout = null;

function stopRuntimeLogPolling() {
    if (runtimeLogTimeout) {
        clearTimeout(runtimeLogTimeout);
        runtimeLogTimeout = null;
    }
}

async function fetchRuntimeLogs(appId) {
    try {
        const res = await fetch(`/api/runtime-logs/${appId}`);
        if (res.ok) {
            const logs = await res.json();
            const liveTerminal = document.getElementById('live-terminal-body');
            const isNearBottom = liveTerminal.innerHTML === '' || liveTerminal.scrollHeight - liveTerminal.scrollTop <= liveTerminal.clientHeight + 50;
            liveTerminal.innerHTML = formatLogsToHtml(logs);
            if (isNearBottom) {
                liveTerminal.scrollTop = liveTerminal.scrollHeight;
            }
        }
    } catch (e) {
        console.error("Error fetching runtime logs:", e);
    }

    // Schedule next run only if polling is still active and it matches the current app
    const content = document.getElementById('live-content');
    if (content && (content.style.display === 'flex' || content.style.display === 'block') && appId === currentAppId) {
        stopRuntimeLogPolling(); // clear any previous scheduled timeout
        runtimeLogTimeout = setTimeout(() => fetchRuntimeLogs(appId), 3000);
    }
}

// Modify toggleAccordion to start/stop polling
const originalToggleAccordion = toggleAccordion;
toggleAccordion = function (contentId, headerElement) {
    originalToggleAccordion(contentId, headerElement);

    // If the live content was just opened, start polling runtime logs
    if (contentId === 'live-content') {
        const content = document.getElementById(contentId);
        if (content.style.display === 'flex' || content.style.display === 'block') {
            if (currentAppId) {
                stopRuntimeLogPolling();
                fetchRuntimeLogs(currentAppId);
            }
        } else {
            stopRuntimeLogPolling();
        }
    }
};

function downloadLogs(targetId = 'terminal-body', filename = 'logs.txt') {
    const el = document.getElementById(targetId);
    if (!el) return;
    const text = el.innerText || el.textContent || '';
    if (!text.trim()) {
        alert('Endirmək üçün heç bir loq tapılmadı!');
        return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Also modify copyTerminalLogs to handle specific IDs
function copyTerminalLogs(targetId = 'terminal-body') {
    const el = document.getElementById(targetId);
    if (!el) return;
    const text = el.innerText || el.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Loqlar kopyalandı');
        }).catch(err => {
            console.error('Kopyalama xətası:', err);
        });
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            alert('Loqlar kopyalandı');
        } catch (err) {
            console.error('Kopyalama xətası (fallback):', err);
        }
        document.body.removeChild(ta);
    }
}
let currentAppId = null;



let currentAppDetailsId = null;
let currentAppDetailsName = null;

async function openAppDetails(appId, autoSwitchToOverview = true) {
    localStorage.setItem('active_app_id', appId);
    currentAppDetailsId = appId;
    try {
        const res = await fetch(`/api/applications/${appId}`);
        if (!res.ok) { alert('Layihə məlumatları yüklənmədi.'); return; }
        const app = await res.json();
        currentAppDetailsName = app.name;

        // Populate Header
        document.getElementById('detail-app-name').innerText = app.name;

        const statusColors = {
            'running': '#00e676', 'success': '#00e676',
            'failed': '#ff1744', 'deploying': '#00d2ff',
            'building': '#00d2ff', 'cancelled': '#ff9800', 'idle': '#9aa0a6',
            'stopped': '#757575'
        };
        const sc = statusColors[app.status] || '#9aa0a6';
        const statBadge = document.getElementById('detail-app-status');
        statBadge.innerText = app.status.toUpperCase();
        statBadge.style.color = sc;
        statBadge.style.background = sc + '20'; // transparent background
        statBadge.style.border = `1px solid ${sc}50`;

        // Check if there is an IP we can use to generate the link
        let serverIp = 'localhost';
        try {
            const srvRes = await fetch(`/api/servers/${app.server_id}`);
            if (srvRes.ok) {
                const srv = await srvRes.json();
                serverIp = srv.ip;
                document.getElementById('detail-overview-server').innerText = srv.name + ' (' + srv.ip + ')';
            } else {
                document.getElementById('detail-overview-server').innerText = app.server_id;
            }
        } catch (e) {
            document.getElementById('detail-overview-server').innerText = app.server_id;
        }

        const resolvedIp = (serverIp === 'local' || serverIp === 'localhost') ? 'localhost' : serverIp;
        const appUrl = app.cf_worker_url ? app.cf_worker_url : `http://${resolvedIp}:${app.port}`;
        document.getElementById('detail-app-url').innerText = appUrl;
        document.getElementById('detail-app-link').href = appUrl;

        // Populate Overview
        document.getElementById('detail-overview-repo').innerText = app.repo_url || '-';
        document.getElementById('detail-overview-branch').innerText = app.branch || '-';
        document.getElementById('detail-overview-port').innerText = app.port || '-';

        // Populate Settings inputs using existing function but bypassing modal
        openAppSettings(appId, false); // false = don't show modal

        // Pending redeploy bayrağını yoxla
        const hasPending = localStorage.getItem(`pending_redeploy_${appId}`) === 'true';
        markRedeployPending(hasPending);

        // Deployments tarixçəsini yüklə
        loadAppDeployments(appId);

        switchTab('app-details');
        if (autoSwitchToOverview) {
            switchAppTab('overview');
        }

        // Stop background polling from other views just in case
        stopLogPolling();
        stopRuntimeLogPolling();

    } catch (e) {
        console.error("openAppDetails error", e);
    }
}

function switchAppTab(tabId) {
    localStorage.setItem('active_app_subtab', tabId);
    // Hide all subtab contents
    document.querySelectorAll('.subtab-content').forEach(el => el.style.display = 'none');
    // Remove active class from subtab buttons
    document.querySelectorAll('.subtab-btn').forEach(el => el.classList.remove('active'));

    // Show selected subtab (logs tab flex layout tələb edir)
    const selectedContent = document.getElementById(`subtab-${tabId}`);
    if (selectedContent) {
        selectedContent.style.display = tabId === 'logs' ? 'flex' : 'block';
    }

    // Set active button
    const selectedBtn = document.querySelector(`.subtab-btn[data-subtab="${tabId}"]`);
    if (selectedBtn) selectedBtn.classList.add('active');

    // Handle specific tab actions
    if (tabId === 'logs' && currentAppDetailsId) {
        // If switching to logs, and we aren't already viewing logs, we could fetch recent. 
        // For now, viewLogs sets up the intervals if an active deploy exists, otherwise just polls runtime logs.
        viewLogs(currentAppDetailsId, false); // false = don't switch main tabs
    } else {
        stopLogPolling();
        stopRuntimeLogPolling();
    }
}

function deleteAppFromDetails() {
    if (!currentAppDetailsId || !currentAppDetailsName) return;
    deleteApp(currentAppDetailsId, currentAppDetailsName);
}

// --- Help Center & System Update ---


async function loadAppDeployments(appId) {
    if (!appId) return;
    const container = document.getElementById('overview-deployments-list');
    if (!container) return;

    try {
        const res = await fetch(`/api/deployments/${appId}`);
        if (!res.ok) throw new Error("Failed to fetch deployments");
        const deployments = await res.json();

        if (deployments.length === 0) {
            container.innerHTML = `<div class="no-data">Hələ heç bir deployment yoxdur.</div>`;
            return;
        }

        const statusColors = {
            'success': '#00e676',
            'failed': '#ff1744',
            'deploying': '#00d2ff',
            'building': '#00d2ff',
            'cancelled': '#ff9800',
            'pending': '#9aa0a6',
            'stopped': '#757575'
        };

        container.innerHTML = deployments.map(d => {
            const color = statusColors[d.status] || '#9aa0a6';
            let date = d.created_at;
            try {
                const isoStr = d.created_at.trim().replace(" ", "T") + "Z";
                date = new Date(isoStr).toLocaleString('az-AZ');
            } catch (e) {
                console.error(e);
            }

            // Show Cancel button if building or deploying
            const showCancel = d.status === 'building' || d.status === 'deploying';
            const cancelBtn = showCancel ?
                `<button class="btn btn-secondary" onclick="cancelDeploymentFromOverview('${d.id}', '${appId}')" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; color: #ff9100; border-color: rgba(255,145,0,0.3); background: rgba(255,145,0,0.05);">🛑 Ləğv Et</button>` : '';

            return `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); padding: 0.8rem 1rem; border-radius: 8px; gap: 1rem; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap;">
                        <span style="font-family: monospace; font-size: 0.8rem; background: rgba(255,255,255,0.05); padding: 0.2rem 0.5rem; border-radius: 4px; color: #94a3b8;">#${d.id.substring(0, 8)}</span>
                        <span style="font-size: 0.75rem; color: var(--text-secondary);">${date}</span>
                        <span style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: ${color}; background: ${color}15; border: 1px solid ${color}40; padding: 0.15rem 0.5rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;">
                            ${d.status === 'building' || d.status === 'deploying' ? '🔄 ' : ''}${d.status}
                        </span>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        ${cancelBtn}
                        <button class="btn btn-secondary" onclick="viewDeploymentLogs('${appId}', '${d.id}')" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">📋 Loqlar</button>
                    </div>
                </div>
            `;
        }).join('');

        // Set up periodic polling for overview deployments if tab is active and there's a building deploy
        const hasActiveDeploy = deployments.some(d => d.status === 'building' || d.status === 'deploying');
        if (hasActiveDeploy) {
            startOverviewDeploymentsPolling(appId);
        } else {
            stopOverviewDeploymentsPolling();
        }

    } catch (e) {
        console.error("Failed to load deployments for overview", e);
        container.innerHTML = `<div class="no-data" style="color: var(--danger-color);">Tarixçə yüklənərkən xəta baş verdi.</div>`;
    }
}

function viewDeploymentLogs(appId, deployId = null) {
    switchAppTab('logs');
    if (deployId) {
        viewLogs(appId, false, deployId);
    }
}

async function onLogDeploymentChange() {
    const selector = document.getElementById('log-deployment-selector');
    if (!selector) return;
    const val = selector.value;
    if (val === 'latest') {
        viewLogs(currentAppId, false, null);
    } else {
        viewLogs(currentAppId, false, val);
    }
}

async function cancelDeploymentFromOverview(deployId, appId) {
    showConfirmCard({
        icon: '🛑',
        title: 'Yayımı Ləğv Et?',
        subtitle: 'Seçilmiş deployment dayandırılacaq',
        body: 'Bu deployment-i ləğv etmək istədiyinizdən əminsiniz?',
        confirmText: '🛑 Bəli, Ləğv Et',
        confirmStyle: 'background: #ff9100; color: white;',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/deploy/cancel/${deployId}`, { method: 'POST' });
                if (res.ok) {
                    addActivityLog('Yayım ləğv edildi', 'delete');
                    loadAppDeployments(appId);
                    loadApplications();
                }
            } catch (e) {
                console.error("Failed to cancel deployment from overview", e);
            }
        }
    });
}

function startOverviewDeploymentsPolling(appId) {
    if (overviewDeploymentsInterval) return;
    overviewDeploymentsInterval = setInterval(() => {
        const overviewTab = document.getElementById('subtab-overview');
        if (overviewTab && overviewTab.style.display === 'block' && currentAppDetailsId === appId) {
            loadAppDeployments(appId);
        } else {
            stopOverviewDeploymentsPolling();
        }
    }, 3000);
}

function stopOverviewDeploymentsPolling() {
    if (overviewDeploymentsInterval) {
        clearInterval(overviewDeploymentsInterval);
        overviewDeploymentsInterval = null;
    }
}

// Modify switchAppTab to stop/start polling appropriately
const originalSwitchAppTab = switchAppTab;
switchAppTab = function (tabId) {
    originalSwitchAppTab(tabId);
    if (tabId === 'overview' && currentAppDetailsId) {
        loadAppDeployments(currentAppDetailsId);
    } else {
        stopOverviewDeploymentsPolling();
    }
};

// --- Debug mode outline details and copying system ---
function toggleDebugMode() {
    document.body.classList.toggle('debug-mode');
    const isDebug = document.body.classList.contains('debug-mode');
    localStorage.setItem('debug_mode', isDebug ? 'true' : 'false');
    if (isDebug) {
        if (typeof initDebugTooltips === 'function') initDebugTooltips();
    } else {
        if (typeof removeDebugTooltips === 'function') removeDebugTooltips();
    }
}


const originalLoadApplications = loadApplications;
loadApplications = async function () {
    if (typeof originalLoadApplications === 'function') {
        await originalLoadApplications();
    }
    if (typeof initDebugTooltips === 'function') {
        setTimeout(initDebugTooltips, 500);
    }
};

const originalViewLogs = typeof viewLogs === 'function' ? viewLogs : null;
viewLogs = function (appId, switchMainTab = true, specificDeployId = null) {
    if (typeof originalViewLogs === 'function') {
        originalViewLogs(appId, switchMainTab, specificDeployId);
    }
    if (typeof initDebugTooltips === 'function') {
        setTimeout(initDebugTooltips, 500);
    }
};


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
    appShowOverlay('cf-help-overlay');
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

    appShowOverlay('cf-setup-overlay');
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
showModal = function (id) {
    originalShowModal(id);
    if (id === 'plugins-modal') {
        loadPlugins();
    }
};

// ESC düyməsi ilə ən öndəki (aktiv) pəncərəni bağlamaq
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        let topWindowId = null;
        let maxZ = -1;
        Object.keys(activeWindows).forEach(winId => {
            if (activeWindows[winId] && !minimizedWindows[winId]) {
                const backdrop = document.getElementById(winId);
                if (backdrop) {
                    const card = backdrop.querySelector('.modal-card');
                    if (card) {
                        const z = parseInt(card.style.zIndex) || 0;
                        if (z > maxZ) {
                            maxZ = z;
                            topWindowId = winId;
                        }
                    }
                }
            }
        });
        if (topWindowId) {
            closeModal(topWindowId);
        }
    }
});

// ── Terminal sabit hündürlük hesablaması ─────────────────────────────────────
// Footer: position:fixed, bottom:10px, height:36px → 10+36+20 = 66px gap
function fitTerminalHeight() {
    const terminals = [
        document.getElementById('terminal-body'),
        document.getElementById('live-terminal-body')
    ];
    const FOOTER_CLEARANCE = 66; // footer 10px+36px + 20px boşluq
    terminals.forEach(el => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.top < 10) return; // element gizlidirsə keç
        const available = window.innerHeight - rect.top - FOOTER_CLEARANCE;
        if (available > 80) {
            el.style.setProperty('height', available + 'px', 'important');
            el.style.setProperty('flex', 'none', 'important');
        }
    });
}

window.addEventListener('resize', fitTerminalHeight);

['btn-show-build', 'btn-show-live'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => setTimeout(fitTerminalHeight, 50));
});

document.querySelectorAll('[data-subtab="logs"]').forEach(el => {
    el.addEventListener('click', () => setTimeout(fitTerminalHeight, 100));
});

document.querySelectorAll('.nav-btn').forEach(el => {
    el.addEventListener('click', () => setTimeout(fitTerminalHeight, 150));
});

setTimeout(fitTerminalHeight, 500);

// ── Custom Searchable Repo Dropdown for Settings ───────────────────────────────
function showSettingsRepoDropdown() {
    const listEl = document.getElementById('settings-repo-dropdown-list');
    if (listEl) {
        listEl.style.display = 'block';
        renderSettingsRepoList(gitHubRepos);
    }
}

function filterSettingsRepos(val) {
    const filtered = gitHubRepos.filter(r => r.full_name.toLowerCase().includes(val.toLowerCase()));
    renderSettingsRepoList(filtered);
}

function selectSettingsRepo(fullName) {
    const searchInput = document.getElementById('settings-repo-search');
    const urlInput = document.getElementById('settings-repo-url');
    if (searchInput) searchInput.value = fullName;
    if (urlInput) urlInput.value = 'https://github.com/' + fullName;
    
    const listEl = document.getElementById('settings-repo-dropdown-list');
    if (listEl) listEl.style.display = 'none';
}

function renderSettingsRepoList(repos) {
    const listEl = document.getElementById('settings-repo-dropdown-list');
    if (!listEl) return;
    if (repos.length === 0) {
        listEl.innerHTML = '<div style="padding:10px; color:var(--text-secondary); text-align:center; font-size:0.9rem;">Heç bir repo tapılmadı</div>';
        return;
    }
    listEl.innerHTML = repos.map(repo => {
        const isPrivate = repo.private ? "🔒" : "🔓";
        return `
            <div onclick="selectSettingsRepo('${repo.full_name}')" style="padding:10px 15px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.02); display:flex; align-items:center; justify-content:space-between; transition:background 0.2s; font-size:0.92rem;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                <span style="color:#f5f5f7; display:flex; align-items:center; gap:8px;">${isPrivate} ${repo.full_name}</span>
                <span style="font-size:0.8rem; padding:2px 6px; border-radius:4px; background:${repo.private ? 'rgba(235,94,85,0.1)' : 'rgba(46,204,113,0.1)'}; color:${repo.private ? '#eb5e55' : '#2ecc71'};">${repo.private ? 'Private' : 'Public'}</span>
            </div>
        `;
    }).join('');
}

// Close settings repo dropdown on click outside
document.addEventListener('click', function(e) {
    const list = document.getElementById('settings-repo-dropdown-list');
    const search = document.getElementById('settings-repo-search');
    if (list && search && !search.contains(e.target) && !list.contains(e.target)) {
        list.style.display = 'none';
    }
});

// --- SSH Keys Management UI JS Logic ---
// --- SSH Keys Management UI JS Logic (Modularized in keys_tokens.js) ---

async function loadSshKeysDropdown(dropdownId, selectValue = null) {
    const select = document.getElementById(dropdownId);
    if (!select) return;

    try {
        const res = await fetch('/api/ssh-keys');
        const keys = res.ok ? await res.json() : [];
        
        let options = `<option value="">-- Qlobal SSH Açarından İstifadə Etmə (Əllə Yaz) --</option>`;
        if (keys && keys.length > 0) {
            options += keys.map(k => `<option value="${k.id}" ${selectValue === k.id ? 'selected' : ''}>🔑 ${k.name}</option>`).join('');
        }
        select.innerHTML = options;

        const wrapperId = dropdownId === 'srv-key-id' ? 'srv-key-wrapper' : 'edit-srv-key-wrapper';
        handleServerKeySelect(dropdownId, wrapperId);
    } catch (e) {
        console.error("Failed to load SSH keys for dropdown", e);
    }
}

// Window Global Exports
window.openAppDetails = openAppDetails;
window.switchAppTab = switchAppTab;
window.loadApplications = loadApplications;


