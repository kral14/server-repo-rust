// Load applications from Rust API
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
        const statApps = document.getElementById('stat-apps-count');
        if (statApps) statApps.innerText = globalApps.length;

        if (apps.length === 0) {
            if (appsList) appsList.innerHTML = `<div class="no-data">Hələ heç bir layihə əlavə edilməyib.</div>`;
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
                    <h3 style="display: flex; align-items: center;">
                        <i data-lucide="server" style="width: 18px; height: 18px; color: #38bdf8; margin-right: 8px; flex-shrink: 0;"></i>
                        <span>${srvName}</span> <span class="ip" style="margin-left: 6px;">(${srvIp})</span>
                    </h3>
                    <div class="server-group-header-info">
                        <span class="server-stats-badge" id="srv-stats-cpu-${sid}">
                            CPU: <strong>--</strong>
                        </span>
                        <span class="server-stats-badge" id="srv-stats-ram-${sid}">
                            RAM: <strong>-- / -- MB</strong>
                        </span>
                        <div class="server-header-actions">
                            <span class="server-action-link" onclick="goToServerSettings('${sid}')" style="display: inline-flex; align-items: center; gap: 4px;">
                                <i data-lucide="settings" style="width: 13px; height: 13px;"></i> Sazlamalar
                            </span>
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
                <span class="app-load-badge" data-app-name="${app.name}" id="app-load-${app.id}" style="display: inline-flex; align-items: center; gap: 4px;">
                    <i data-lucide="cpu" style="width: 12px; height: 12px; vertical-align: -1px; color: #facc15;"></i> CPU: <strong>${cpuVal}</strong> | <i data-lucide="database" style="width: 12px; height: 12px; vertical-align: -1px; color: #a78bfa;"></i> RAM: <strong>${memVal}</strong>
                </span>
                `;


                const isCfInstalled = installedPlugins['cloudflare'] || false;

                html += `
                <div class="list-item" onclick="openAppDetails('${app.id}')" style="cursor: pointer; transition: all 0.2s ease; position: relative;">
                    <div class="item-info" style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1; min-width: 0;">
                            <h3 style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                <span style="display: inline-flex; align-items: center; gap: 6px; width: 200px; min-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${app.name}">
                                    <i data-lucide="box" style="width: 16px; height: 16px; color: #38bdf8; flex-shrink: 0;"></i>
                                    <span style="overflow: hidden; text-overflow: ellipsis;">${app.name}</span>
                                </span>
                                ${app.status === 'success' || app.status === 'running' ? `
                                <a href="${apiLink}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: var(--accent-color); text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(0, 210, 255, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;">
                                    <i data-lucide="external-link" style="width: 12px; height: 12px;"></i> Lokal Keçid
                                </a>
                                ${app.cloudflare_url ? `
                                <a href="${app.cloudflare_url}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: #ff9800; text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(255, 152, 0, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;">
                                    <i data-lucide="cloud" style="width: 12px; height: 12px;"></i> Cloudflare Keçidi
                                </a>
                                ` : ''}
                                ${app.cf_worker_url ? `
                                <a href="${app.cf_worker_url}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: #00e676; text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(0, 230, 118, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;" title="Sabit Worker Linki">
                                    <i data-lucide="globe" style="width: 12px; height: 12px;"></i> Worker Linki
                                </a>
                                ` : ''}
                                ${isCfInstalled ? `
                                <button onclick="generateCloudflareTunnel(event, '${app.id}')" style="font-size: 0.75rem; color: #fff; background: #e67e22; border: none; border-radius: 4px; padding: 0.2rem 0.5rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem;" title="Cloudflare Tunelini İşə Sal / Link Al">
                                    <i data-lucide="radio" style="width: 12px; height: 12px;"></i> Tunnel Al
                                </button>
                                ` : ''}
                                ` : ''}
                                ${appStatsHtml}
                            </h3>
                            <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary); display: flex; gap: 1rem; align-items: center;">
                                <span style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-flex; align-items: center; gap: 4px;" title="${app.repo_url}">
                                    <i data-lucide="git-branch" style="width: 13px; height: 13px; color: #818cf8; flex-shrink: 0;"></i>
                                    <span>${shortUrl} (${app.branch})</span>
                                </span>
                                <span style="display: inline-flex; align-items: center; gap: 4px;">
                                    <i data-lucide="network" style="width: 13px; height: 13px; color: #38bdf8;"></i> Port: <strong>${app.port}</strong>
                                </span>
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
                                    <button onclick="event.stopPropagation(); openAppDetails('${app.id}')" style="display: inline-flex; align-items: center; gap: 6px; width: 100%;">
                                        <i data-lucide="eye" style="width: 14px; height: 14px;"></i> Detallara Bax
                                    </button>
                                    <button class="danger" onclick="handleDeleteAppClick(event, '${app.id}', '${encodeURIComponent(app.name || 'Adsız Layihə')}')" style="display: inline-flex; align-items: center; gap: 6px; width: 100%;">
                                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Sil
                                    </button>
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

        const renderHash = JSON.stringify(apps.map(a => `${a.id}_${a.name}_${a.status}_${a.port}_${a.server_id}_${a.cloudflare_url}_${a.cf_worker_url}`));
        if (appsList && appsList.getAttribute('data-render-hash') !== renderHash) {
            appsList.setAttribute('data-render-hash', renderHash);
            appsList.innerHTML = html;
        }

        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }

        // Immediately update stats UI with cache if populated
        updateStatsUI(servers);

        if (document.body.classList.contains('debug-mode')) {
            updateDebugDimensions();
        }
    } catch (e) {
        console.error("Failed to load applications", e);
    }
}

let activeSourceMode = 'manual';
let gitHubRepos = [];

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
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const modal = document.getElementById('app-modal');
    if (modal && (modal.style.display === 'none' || modal.classList.contains('minimized'))) {
        return;
    }

    const nameEl = document.getElementById('app-name');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
        showToast('Zəhmət olmasa Layihə Adını (Service Name) daxil edin.', 'warning');
        if (nameEl) nameEl.focus();
        return;
    }

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
            closeModal('app-modal');
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
    const safeName = appName || 'Adsız Layihə';
    showConfirmCard({
        icon: '🗑️',
        title: 'Tətbiq Silinsin?',
        subtitle: safeName,
        body: `<strong>DİQQƏT:</strong> Bu əməliyyat həm verilənlər bazasından, həm də serverdən (Docker konteyner, kodlar) tətbiqi tamamilə siləcək.`,
        warning: '⚠️ Bu əməliyyat geri alına bilməz!',
        confirmText: '🗑️ Sil',
        confirmStyle: 'background: #ff1744; color: white;',
        onConfirm: async () => {
            showModal('delete-terminal-modal');

            const termBody = document.getElementById('delete-terminal-body');
            termBody.innerHTML = '';

            const addLog = (text, color = '#888') => {
                const div = document.createElement('div');
                div.style.color = color;
                div.textContent = text;
                termBody.appendChild(div);
                termBody.scrollTop = termBody.scrollHeight;
                
                if (!deletionLogsCache[safeName]) {
                    deletionLogsCache[safeName] = [];
                }
                deletionLogsCache[safeName].push(text);
            };

            addLog(`[SİSTEM] Layihə silinməsi başladıldı: ${safeName}...`);

            try {
                addLog('[SİSTEM] Server tərəfində təmizləmə aparılır...', '#ff9800');

                // API DELETE sorğusunu başladırıq
                const res = await fetch(`/api/applications/${appId}`, { method: 'DELETE' });
                
                if (res.ok) {
                    addLog('✅ Layihə uğurla silindi!', '#00e676');
                    addActivityLog(`Tətbiq silindi: ${safeName}`, 'delete');
                    
                    const appsList = document.getElementById('applications-list');
                    if (appsList) appsList.removeAttribute('data-render-hash');
                    await loadApplications();

                    setTimeout(() => {
                        closeModal('delete-terminal-modal');
                        switchTab('applications');
                    }, 1000);
                } else {
                    const err = await res.text();
                    addLog(`❌ XƏTA: Server silmə sorğusunu tamamlaya bilmədi. Cavab: ${err}`, '#ff1744');
                    addActivityLog(`Tətbiq silmə uğursuz: ${safeName}`, 'error');
                    
                    const closeBtn = document.createElement('button');
                    closeBtn.textContent = 'Bağla';
                    closeBtn.style.cssText = 'margin-top: 15px; background: #555; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;';
                    closeBtn.onclick = () => { closeModal('delete-terminal-modal'); loadApplications(); };
                    termBody.appendChild(closeBtn);
                }
            } catch (e) {
                addLog(`❌ BAĞLANTI XƏTASI: Serverdən cavab alınmadı. Detal: ${e.message}`, '#ff1744');
                addActivityLog(`Tətbiq silmə xətası: ${safeName}`, 'error');
                
                const closeBtn = document.createElement('button');
                closeBtn.textContent = 'Bağla';
                closeBtn.style.cssText = 'margin-top: 15px; background: #555; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;';
                closeBtn.onclick = () => { closeModal('delete-terminal-modal'); loadApplications(); };
                termBody.appendChild(closeBtn);
            }
        }
    });
}
