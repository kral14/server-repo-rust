document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadServers();
    loadApplications();
    loadGithubToken();
    resetEnvVarsContainer();
    fetchAppVersion();
    renderActivityLogs();

    // Restore active tab
    const activeTab = localStorage.getItem('active_tab') || 'dashboard';
    if (activeTab === 'app-details') {
        const appId = localStorage.getItem('active_app_id');
        if (appId) {
            openAppDetails(appId).then(() => {
                const subTab = localStorage.getItem('active_app_subtab');
                if (subTab) switchAppTab(subTab);
            });
        } else {
            switchTab('applications');
        }
    } else {
        switchTab(activeTab);
    }

    // Fetch server stats periodically
    fetchServerStats();
    setInterval(fetchServerStats, 10000);

    // Theme Toggle Logic
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        updateThemeUI();
        themeBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeUI();
        });
    }
});

function updateThemeUI() {
    const theme = document.documentElement.getAttribute('data-theme');
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (theme === 'light') {
        icon.innerText = '🌙';
        text.innerText = 'Qara Tema';
    } else {
        icon.innerText = '☀️';
        text.innerText = 'Açıq Tema';
    }
}

async function fetchAppVersion() {
    try {
        const res = await fetch('/api/version');
        if (res.ok) {
            const data = await res.json();
            const el = document.getElementById('app-version');
            if (el && data.version) {
                const localVersion = data.version;
                // Yalnız versiya mətnini göstər, kliklenebilir et
                // Badge məntiqi initSystemUpdates() tərəfindən idarə olunur
                el.innerHTML = `<span id="version-text" onclick="openSystemUpdateModal()" style="cursor:pointer; text-decoration:underline; text-underline-offset:3px;" title="Versiyalara bax">v${localVersion}</span> <span id="version-badge"></span>`;
            }
        }
    } catch (e) {
        // silently ignore
    }
}

function copyTerminalLogs(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.innerText || el.textContent;
    
    function showSuccess() {
        const btn = document.getElementById('copy-logs-btn');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '✅ Kopyalandı!';
            btn.style.color = 'var(--success-color)';
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.style.color = 'var(--text-secondary)';
            }, 2000);
        }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showSuccess).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
    
    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showSuccess();
        } catch (e) {
            console.error('Copy failed', e);
        }
        document.body.removeChild(ta);
    }
}

// Tab Switching Logic
function initTabs() {
    const navButtons = document.querySelectorAll('.nav-btn');

    navButtons.forEach(btn => {
        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return; // Skip buttons without data-tab (like modal triggers)

        btn.addEventListener('click', () => {
            switchTab(targetTab);
        });
    });
}

// Modal management
function showModal(id) {
    document.getElementById(id).classList.add('active');
}

// Global modal close logic
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
    if (id === 'logs-modal') {
        stopLogPolling();
    }
}

// Load servers from Rust API
async function loadServers() {
    try {
        const res = await fetch('/api/servers');
        const servers = await res.json();

        const serversList = document.getElementById('servers-list');
        const serverSelect = document.getElementById('app-server');

        document.getElementById('stat-servers-count').innerText = servers.length;

        if (servers.length === 0) {
            serversList.innerHTML = `<div class="no-data">Hələ heç bir server əlavə edilməyib.</div>`;
            serverSelect.innerHTML = `<option value="">Öncə server əlavə edin</option>`;
            return;
        }

        serverSelect.innerHTML = servers.map(s => `<option value="${s.id}">${s.name} (${s.ip})</option>`).join('');

        // Trigger the advisor update since the default selected option has changed
        updateServerStatsAdvisor('app-server', 'app-server-advisor', 'app-memory', 'app-cpu');

        serversList.innerHTML = servers.map(s => `
            <div class="list-item">
                <div class="item-info">
                    <h3>🖥️ ${s.name}</h3>
                    <p>
                        <span><strong>IP:</strong> ${s.ip}</span>
                        <span><strong>İstifadəçi:</strong> ${s.ssh_user}</span>
                    </p>
                </div>
                <div class="item-actions">
                    <button class="btn btn-primary" onclick="setupServer('${s.id}', '${s.name}')" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; background: linear-gradient(135deg, #7c3aed, #00d2ff); border: none;">⚙️ Serveri Hazırla</button>
                    <span class="btn btn-secondary" style="padding: 0.4rem 0.75rem; font-size: 0.8rem;">Qoşulub ✅</span>
                    <button class="btn btn-secondary" onclick="deleteServer('${s.id}', '${s.name}')" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; background: rgba(255,0,0,0.1); color: #ff1744; border-color: rgba(255,0,0,0.2);">&#128465;</button>
                </div>
            </div>
        `).join('');
        if (document.body.classList.contains('debug-mode')) {
            updateDebugDimensions();
        }
    } catch (e) {
        console.error("Failed to load servers", e);
    }
}

// Load applications from Rust API
async function loadApplications() {
    try {
        const [appRes, srvRes] = await Promise.all([
            fetch('/api/applications'),
            fetch('/api/servers')
        ]);
        const apps = await appRes.json();
        const servers = await srvRes.json();

        const serverMap = {};
        if (Array.isArray(servers)) {
            servers.forEach(s => serverMap[s.id] = s.ip);
        }

        const appsList = document.getElementById('apps-list');
        document.getElementById('stat-apps-count').innerText = apps.length;

        if (apps.length === 0) {
            appsList.innerHTML = `<div class="no-data">Hələ heç bir layihə əlavə edilməyib.</div>`;
            return;
        }

        appsList.innerHTML = apps.map(app => {
            const shortUrl = (app.repo_url || '').replace('https://github.com/', '').replace('https://', '');
            const statusColors = {
                'running': '#00e676', 'success': '#00e676',
                'failed': '#ff1744', 'deploying': '#00d2ff',
                'building': '#00d2ff', 'cancelled': '#ff9800', 'idle': '#9aa0a6'
            };
            const sc = statusColors[app.status] || '#9aa0a6';
            const srvIp = serverMap[app.server_id] || 'localhost';
            const apiLink = `http://${srvIp}:${app.port}`;

            return `
            <div class="list-item" onclick="openAppDetails('${app.id}')" style="cursor: pointer; transition: all 0.2s ease;">
                <div class="item-info" style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                            🚀 ${app.name}
                            ${app.status === 'success' || app.status === 'running' ? `
                            <a href="${apiLink}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: var(--accent-color); text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(0, 210, 255, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;">
                                🔗 API Keçidi
                            </a>
                            ` : ''}
                        </h3>
                        <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary); display: flex; gap: 1rem; align-items: center;">
                            <span style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${app.repo_url}">🐱 ${shortUrl} (${app.branch})</span>
                            <span>🔌 Port: <strong>${app.port}</strong></span>
                        </p>
                    </div>
                    <div style="display:inline-flex; align-items:center; gap:0.5rem; background: rgba(255,255,255,0.05); padding: 0.4rem 0.8rem; border-radius: 8px;">
                        <span style="width:8px; height:8px; border-radius:50%; background:${sc}; display:inline-block; box-shadow: 0 0 5px ${sc};"></span>
                        <span style="color:${sc}; font-weight:500;">${app.status.toUpperCase()}</span>
                    </div>
                </div>
            </div>
        `}).join('');
        if (document.body.classList.contains('debug-mode')) {
            updateDebugDimensions();
        }
    } catch (e) {
        console.error("Failed to load applications", e);
    }
}

// Handle server creation
async function handleCreateServer(event) {
    event.preventDefault();
    const payload = {
        name: document.getElementById('srv-name').value,
        ip: document.getElementById('srv-ip').value,
        ssh_user: document.getElementById('srv-user').value,
        ssh_key: document.getElementById('srv-key').value,
    };

    try {
        const res = await fetch('/api/servers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal('server-modal');
            document.getElementById('server-form').reset();
            addActivityLog(`Server əlavə edildi: ${payload.name} (${payload.ip})`, 'server');
            loadServers();
        }
    } catch (e) {
        addActivityLog(`Server yaratma uğursuz: ${e.message}`, 'error');
        console.error("Failed to create server", e);
    }
}

// Delete server
async function deleteServer(id, name) {
    showConfirmCard({
        icon: '🖥️',
        title: 'Server Silinsin?',
        subtitle: name,
        body: `"${name}" serverini silmək istədiyinizə əminsiniz? <br><br><strong>Qeyd:</strong> Bu serverə bağlı layihələr varsa, silinmə uğursuz ola bilər.`,
        confirmText: '🗑️ Sil',
        confirmStyle: 'background: #ff1744; color: white;',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/servers/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    addActivityLog(`Server silindi: ${name}`, 'delete');
                    loadServers();
                } else {
                    const err = await res.text();
                    addActivityLog(`Server silmə uğursuz: ${err}`, 'error');
                    showInfoCard("❌ Xəta", "Serveri silmək mümkün olmadı", err);
                }
            } catch (e) {
                console.error("Silinmə xətası", e);
                showInfoCard("❌ Xəta", "Bağlantı xətası yarandı", e.message);
            }
        }
    });
}

// Setup (Provision) server
async function setupServer(id, name) {
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;

    showConfirmCard({
        icon: '🛠️',
        title: 'Hazırlıq Başladılsın?',
        subtitle: name,
        body: `"${name}" serverində avtomatik hazırlıq (Swap artırmaq və Docker qurmaq) başladılsın?<br>Bu proses 1-2 dəqiqə çəkə bilər.`,
        confirmText: '🚀 Başlat',
        onConfirm: async () => {
            btn.innerHTML = "⏳ Hazırlanır (Gözləyin)...";
            btn.disabled = true;

            try {
                const res = await fetch(`/api/servers/${id}/setup`, { method: 'POST' });
                
                if (res.ok) {
                    addActivityLog(`Server hazırlandı: ${name}`, 'setup');
                    showInfoCard('✅ Uğurlu', `"${name}" serveri`, 'Docker uğurla quraşdırıldı. Artıq layihə yükləyə bilərsiniz.');
                    btn.innerHTML = "✅ Hazırdır";
                } else {
                    const err = await res.text();
                    addActivityLog(`Server hazırlıq uğursuz: ${name}`, 'error');
                    showInfoCard('❌ Xəta', 'Hazırlıq zamanı problem', err);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            } catch (e) {
                console.error("Setup error", e);
                addActivityLog(`Server hazırlıq xətası: ${name}`, 'error');
                showInfoCard('❌ Bağlantı Xətası', 'Serverə qoşula bilmədi.', e.message);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    });
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

        const token = localStorage.getItem('github_token');
        if (token && gitHubRepos.length === 0) {
            loadGithubRepos();
        }
    }
}

// Handle application creation
async function handleCreateApp(event) {
    event.preventDefault();

    let repoUrl = "";
    let branch = "";

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
        const token = localStorage.getItem('github_token');

        // Check if the selected repo is private
        const selectedOption = repoSelect.options[repoSelect.selectedIndex];
        const isPrivate = selectedOption.getAttribute('data-private') === 'true';

        if (isPrivate && token) {
            repoUrl = `https://${token}@github.com/${selectedRepoName}.git`;
        } else {
            repoUrl = `https://github.com/${selectedRepoName}.git`;
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

    const payload = {
        name: document.getElementById('app-name').value.trim(),
        repo_url: repoUrl,
        branch: branch,
        port: parseInt(document.getElementById('app-port').value),
        server_id: server_id,
        env_vars: envVarsString,
        memory_limit: memoryLimit || null,
        cpu_limit: cpuLimit ? parseFloat(cpuLimit) : null,
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
    showConfirmCard({
        icon: '🗑️',
        title: 'Tətbiq Silinsin?',
        subtitle: appName,
        body: `<strong>DİQQƏT:</strong> Bu əməliyyat həm verilənlər bazasından, həm də uzaq serverdən (Docker container, kodlar) hər şeyi geri qaytarılmaz şəkildə siləcək.`,
        warning: '⚠️ Bu əməliyyat geri alına bilməz!',
        confirmText: '🗑️ Sil',
        confirmStyle: 'background: #ff1744; color: white;',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/applications/${appId}`, { method: 'DELETE' });
                if (res.ok) {
                    addActivityLog(`Tətbiq silindi: ${appName}`, 'delete');
                    loadApplications();
                    switchTab('applications');
                } else {
                    const err = await res.text();
                    addActivityLog(`Tətbiq silmə uğursuz: ${appName}`, 'error');
                    showInfoCard('❌ Xəta', 'Silmə zamanı problem', err);
                }
            } catch (e) {
                addActivityLog(`Tətbiq silmə xətası: ${appName}`, 'error');
                showInfoCard('❌ Bağlantı Xətası', 'Serverdən cavab gəlmədi.', e.message);
            }
        }
    });
}

// Trigger Deployment
async function deployApp(id) {
    try {
        const appName = document.getElementById('detail-app-name') ? document.getElementById('detail-app-name').innerText : id;
        const res = await fetch(`/api/deploy/${id}`, { method: 'POST' });
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
function viewLogs(appId, switchMainTab = true) {
    if (switchMainTab) { switchTab('app-details'); switchAppTab('logs'); }

    const terminal = document.getElementById('terminal-body');
    terminal.innerText = 'Yayım başladılır...';
    document.getElementById('cancel-deploy-btn').style.display = 'none';
    document.getElementById('stuck-warning-banner').style.display = 'none';
    document.getElementById('last-update-badge').innerText = '';
    document.getElementById('stream-status-dot').innerText = 'Real-time stream active ●';
    document.getElementById('stream-status-dot').style.color = 'var(--success-color)';
    currentActiveDeploymentId = null;
    currentAppId = appId;
    lastUpdateTime = Date.now();
    lastSeenLog = '';

    // Reset all stages to pending on start
    document.querySelectorAll('.stage-item').forEach(el => {
        el.style.opacity = '0.4';
        el.style.color = 'var(--text-secondary)';
        el.querySelector('.stage-icon').innerHTML = '⚪';
        el.querySelector('.stage-time').innerText = '--';
    });

    // Make sure both accordions are closed by default when viewing logs
    document.getElementById('build-content').style.display = 'none';
    const buildIcon = document.getElementById('build-content').previousElementSibling.querySelector('.accordion-icon');
    if (buildIcon.classList.contains('toggle-text-btn')) {
        buildIcon.innerText = 'Göstər';
        buildIcon.style.background = 'rgba(255,255,255,0.1)';
    }

    document.getElementById('live-content').style.display = 'none';
    const liveIcon = document.getElementById('live-content').previousElementSibling.querySelector('.accordion-icon');
    if (liveIcon.classList.contains('toggle-text-btn')) {
        liveIcon.innerText = 'Göstər';
        liveIcon.style.background = 'rgba(255,255,255,0.1)';
    }

    // Link building is now handled in openAppDetails

    stopLogPolling();
    stopRuntimeLogPolling();

    // Ticker to update "Last update: Xs ago" badge every second
    if (updateBadgeTimer) clearInterval(updateBadgeTimer);
    updateBadgeTimer = setInterval(() => {
        if (!lastUpdateTime) return;
        const secAgo = Math.floor((Date.now() - lastUpdateTime) / 1000);
        const badge = document.getElementById('last-update-badge');
        const stuckBanner = document.getElementById('stuck-warning-banner');
        const statusDot = document.getElementById('stream-status-dot');
        if (badge) badge.innerText = `Son yeniləmə: ${secAgo}s əvvəl`;
        if (secAgo >= 180 && stuckBanner) {
            stuckBanner.style.display = 'block';
        } else if (stuckBanner) {
            stuckBanner.style.display = 'none';
        }
    }, 1000);

    // Poll logs every 1 second
    logInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/deployments/${appId}`);
            const deployments = await res.json();
            if (deployments.length > 0) {
                const latest = deployments[0];

                // Only update terminal if log has changed
                if (latest.logs !== lastSeenLog) {
                    const isNearBottom = lastSeenLog === '' || terminal.scrollHeight - terminal.scrollTop <= terminal.clientHeight + 50;
                    if (!latest.logs && (latest.status === 'failed' || latest.status === 'cancelled')) {
                        terminal.innerText = "[SERVER] Xəta baş verdi və ya yayım ləğv edildi. Loq tapılmadı.";
                    } else if (latest.logs) {
                        terminal.innerText = stripAnsi(latest.logs);
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
                updateDeploymentStages(latest.logs || '');

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
                    if (badge) badge.innerText = '';
                    if (statusDot) {
                        if (latest.status === 'success') {
                            statusDot.innerText = 'Tamamlandı ✅';
                            statusDot.style.color = 'var(--success-color)';
                            const linkBtn = document.getElementById('deploy-app-link-btn');
                            if (linkBtn) linkBtn.style.display = 'inline-block';
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

// Koyeb-style stage parser based on log keywords
function updateDeploymentStages(logText) {
    const stages = [
        {
            id: 'stage-1',
            startPattern: 'Connecting to server',
            endPattern: '[SUCCESS] Workspace directory created',
            errorPattern: '[ERROR] Directory prep failed',
        },
        {
            id: 'stage-2',
            startPattern: '[2/5] Git repository',
            endPattern: '[SUCCESS] Repository cloned',
            errorPattern: '[ERROR] Git checkout failed',
        },
        {
            id: 'stage-3',
            startPattern: '[3/5] Docker image build',
            endPattern: '[SUCCESS] Docker image',
            errorPattern: '[ERROR] Docker build failed',
        },
        {
            id: 'stage-4',
            startPattern: '[4/5]',
            endPattern: '[5/5]',
            errorPattern: null,
        },
        {
            id: 'stage-5',
            startPattern: '[5/5] Yeni konteyner',
            endPattern: '[SUCCESS] T', // matches Tətbiq or TЙ™tbiq
            errorPattern: '[ERROR] Docker run command failed',
        }
    ];

    let anyFailed = false;

    stages.forEach((stage) => {
        const el = document.getElementById(stage.id);
        if (!el) return;

        const iconEl = el.querySelector('.stage-icon');
        const timeEl = el.querySelector('.stage-time');

        const hasStarted = logText.includes(stage.startPattern);
        const hasEnded = logText.includes(stage.endPattern);
        const hasFailed = stage.errorPattern ? logText.includes(stage.errorPattern) : false;

        if (hasFailed || anyFailed) {
            el.style.opacity = '1.0';
            el.style.color = '#ff1744'; // danger color
            iconEl.innerHTML = '❌';
            timeEl.innerText = 'Xəta';
            if (hasFailed) anyFailed = true;
        } else if (hasEnded) {
            el.style.opacity = '1.0';
            el.style.color = '#00e676'; // success color
            iconEl.innerHTML = '✅';
            timeEl.innerText = 'Tamamlandı';
        } else if (hasStarted) {
            el.style.opacity = '1.0';
            el.style.color = '#00d2ff'; // accent color
            iconEl.innerHTML = '<span class="spin-icon">🔄</span>';
            timeEl.innerText = 'Gedir...';
        } else {
            el.style.opacity = '0.4';
            el.style.color = 'var(--text-secondary)';
            iconEl.innerHTML = '⚪';
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

        const nameLabel = document.getElementById('settings-app-name-label');
        if (nameLabel) nameLabel.innerText = `🚀 ${app.name}`;

        document.getElementById('settings-repo-url').value = app.repo_url || '';
        document.getElementById('settings-branch').value = app.branch || 'main';
        document.getElementById('settings-port').value = app.port || 8080;
        populateSettingsEnvVars(app.env_vars || '');
        document.getElementById('settings-build-command').value = app.build_command || '';
        document.getElementById('settings-run-command').value = app.run_command || '';
        document.getElementById('settings-dockerfile-path').value = app.dockerfile_path || '';
        document.getElementById('settings-entrypoint').value = app.entrypoint || '';
        document.getElementById('settings-command').value = app.command || '';
        document.getElementById('settings-work-dir').value = app.work_dir || '';
        document.getElementById('settings-memory-limit').value = app.memory_limit || '';
        document.getElementById('settings-cpu-limit').value = app.cpu_limit || '';

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
        bpBtn.style.background = 'rgba(0,210,255,0.15)';
        bpBtn.style.color = 'var(--accent-color)';
        bpBtn.style.borderColor = 'var(--accent-color)';
        dfBtn.style.background = 'transparent';
        dfBtn.style.color = 'var(--text-secondary)';
        dfBtn.style.borderColor = 'var(--card-border)';
        bpFields.style.display = 'block';
        dfFields.style.display = 'none';
    } else {
        dfBtn.style.background = 'rgba(0,210,255,0.15)';
        dfBtn.style.color = 'var(--accent-color)';
        dfBtn.style.borderColor = 'var(--accent-color)';
        bpBtn.style.background = 'transparent';
        bpBtn.style.color = 'var(--text-secondary)';
        bpBtn.style.borderColor = 'var(--card-border)';
        bpFields.style.display = 'none';
        dfFields.style.display = 'block';
    }
    settingsCurrentBuildType = type;
}

let settingsCurrentBuildType = 'dockerfile';

function buildSettingsPayload() {
    return {
        repo_url: document.getElementById('settings-repo-url').value.trim() || null,
        branch: document.getElementById('settings-branch').value.trim() || null,
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
    };
}

async function saveAppSettings() {
    if (!currentSettingsAppId) return;
    const payload = buildSettingsPayload();
    try {
        const res = await fetch(`/api/applications/${currentSettingsAppId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            loadApplications();
            // Show brief success flash
            const btn = document.querySelector('#app-settings-modal .btn-secondary[onclick="saveAppSettings()"]');
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = '✅ Saxlandı!';
                setTimeout(() => btn.innerHTML = orig, 1800);
            }
        } else {
            const err = await res.text();
            alert('Xəta: ' + err);
        }
    } catch (e) {
        console.error('saveAppSettings error', e);
    }
}

async function saveAndRedeploy() {
    if (!currentSettingsAppId) {
        alert("Layihə seçilməyib!");
        return;
    }
    const payload = buildSettingsPayload();
    try {
        const res = await fetch(`/api/applications/${currentSettingsAppId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {

            loadApplications();
            deployApp(currentSettingsAppId);
        } else {
            const err = await res.text();
            alert('Yadda saxlamaqda xəta: ' + err);
        }
    } catch (e) {
        console.error('saveAndRedeploy error', e);
        alert('Serverlə əlaqə xətası: ' + e);
    }
}

// Copy terminal logs to clipboard
function copyTerminalLogs() {
    const terminal = document.getElementById('terminal-body');
    const text = terminal.innerText || terminal.textContent || '';
    if (!text.trim()) return;

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copy-logs-btn');
        const original = btn.innerHTML;
        btn.innerHTML = '✅ Kopyalandı';
        btn.style.color = 'var(--success-color)';
        btn.style.borderColor = 'var(--success-color)';
        setTimeout(() => {
            btn.innerHTML = original;
            btn.style.color = '';
            btn.style.borderColor = '';
        }, 2000);
    }).catch(() => {
        // Fallback for older browsers
        const range = document.createRange();
        range.selectNodeContents(terminal);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
    });
}

// GitHub Integration Functions
async function loadGithubToken() {
    const token = localStorage.getItem('github_token');
    if (token) {
        document.getElementById('gh-token').value = token;
        verifyGithubToken(token);
    }
}

async function saveGithubToken() {
    const token = document.getElementById('gh-token').value.trim();
    if (!token) {
        localStorage.removeItem('github_token');
        document.getElementById('gh-status').innerText = "Məlumat yoxdur";
        document.getElementById('gh-status').style.color = "#94a3b8";
        document.getElementById('app-repo-select').innerHTML = '<option value="">Token quraşdırılmayıb</option>';
        gitHubRepos = [];
        return;
    }
    localStorage.setItem('github_token', token);
    verifyGithubToken(token);
}

async function verifyGithubToken(token) {
    const statusText = document.getElementById('gh-status');
    statusText.innerText = "Yoxlanılır...";
    statusText.style.color = "#00d2ff";

    try {
        const res = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `token ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            statusText.innerText = `Qoşulub: @${user.login} ✅`;
            statusText.style.color = "#00e676";
            if (activeSourceMode === 'github') {
                loadGithubRepos();
            }
            // Auto close modal after successful save
            setTimeout(() => {
                closeModal('github-modal');
            }, 1000);
        } else {
            statusText.innerText = "Token səhvdir ❌";
            statusText.style.color = "#ff1744";
        }
    } catch (e) {
        statusText.innerText = "Bağlantı xətası ❌";
        statusText.style.color = "#ff1744";
    }
}

async function loadGithubRepos() {
    const token = localStorage.getItem('github_token');
    const repoSelect = document.getElementById('app-repo-select');
    const wizardReposList = document.getElementById('github-repos-list');

    if (repoSelect) {
        if (!token) {
            repoSelect.innerHTML = '<option value="">Öncə GitHub Token daxil edin</option>';
        } else {
            repoSelect.innerHTML = '<option value="">Repolar yüklənir...</option>';
        }
    }

    if (wizardReposList) {
        if (!token) {
            wizardReposList.innerHTML = '<div class="no-data">Token quraşdırılmayıb. Lütfən əvvəlcə GitHub Ayarlarını edin.</div>';
            return;
        }
        wizardReposList.innerHTML = '<div class="no-data">Repolar yüklənir...</div>';
    }

    if (!token) return;

    try {
        const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
            headers: { 'Authorization': `token ${token}` }
        });

        if (res.ok) {
            gitHubRepos = await res.json();

            if (repoSelect) {
                if (gitHubRepos.length === 0) {
                    repoSelect.innerHTML = '<option value="">Heç bir repozitoriya tapılmadı</option>';
                } else {
                    repoSelect.innerHTML = '<option value="">Repozitoriya seçin...</option>' +
                        gitHubRepos.map(repo => {
                            const isPrivate = repo.private ? "🔒" : "🔓";
                            return `<option value="${repo.full_name}" data-private="${repo.private}">${isPrivate} ${repo.full_name}</option>`;
                        }).join('');
                }
            }

            if (wizardReposList) {
                renderReposList(gitHubRepos);
            }
        } else {
            if (repoSelect) repoSelect.innerHTML = '<option value="">Repoları yükləmək alınmadı ❌</option>';
            if (wizardReposList) wizardReposList.innerHTML = '<div class="no-data" style="color: var(--danger-color);">Repoları yükləmək alınmadı ❌</div>';
        }
    } catch (e) {
        console.error(e);
        if (repoSelect) repoSelect.innerHTML = '<option value="">Bağlantı xətası ❌</option>';
        if (wizardReposList) wizardReposList.innerHTML = '<div class="no-data" style="color: var(--danger-color);">Bağlantı xətası ❌</div>';
    }
}

async function handleRepoSelectChange() {
    const repoSelect = document.getElementById('app-repo-select');
    const selectedRepoName = repoSelect.value;
    const branchSelect = document.getElementById('app-branch-select');

    if (!selectedRepoName) {
        branchSelect.innerHTML = '<option value="main">main</option>';
        return;
    }

    branchSelect.innerHTML = '<option value="">Budaqlar yüklənir...</option>';
    const token = localStorage.getItem('github_token');

    try {
        const res = await fetch(`https://api.github.com/repos/${selectedRepoName}/branches`, {
            headers: token ? { 'Authorization': `token ${token}` } : {}
        });

        if (res.ok) {
            const branches = await res.json();
            branchSelect.innerHTML = branches.map(b => `<option value="${b.name}">${b.name}</option>`).join('');

            const hasMain = branches.some(b => b.name === 'main');
            const hasMaster = branches.some(b => b.name === 'master');
            if (hasMain) {
                branchSelect.value = 'main';
            } else if (hasMaster) {
                branchSelect.value = 'master';
            }
        } else {
            branchSelect.innerHTML = '<option value="main">main (yüklənmədi)</option>';
        }
    } catch (e) {
        console.error(e);
        branchSelect.innerHTML = '<option value="main">main (xəta)</option>';
    }
}

// Dynamic Environment Variables Builder (Koyeb-style)
function addEnvVarRow(key = '', val = '') {
    const container = document.getElementById('env-vars-container');
    const row = document.createElement('div');
    row.className = 'env-var-row';
    row.style.display = 'flex';
    row.style.gap = '0.5rem';
    row.style.marginBottom = '0.5rem';
    row.style.alignItems = 'center';

    row.innerHTML = `
        <input type="text" placeholder="Açar (Key)" class="env-key" value="${key}" style="flex: 1; padding: 0.6rem 0.8rem; font-size: 0.85rem;" required>
        <input type="text" placeholder="Dəyər (Value)" class="env-value" value="${val}" style="flex: 2; padding: 0.6rem 0.8rem; font-size: 0.85rem;" required>
        <button type="button" onclick="this.parentElement.remove()" style="background: transparent; border: none; color: var(--danger-color); font-size: 1.2rem; cursor: pointer; padding: 0 0.5rem; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">✕</button>
    `;
    container.appendChild(row);
}

function resetEnvVarsContainer() {
    const container = document.getElementById('env-vars-container');
    if (container) {
        container.innerHTML = '';
        addEnvVarRow(); // Add one default empty row
    }
}

// Dynamic Environment Variables Builder for Settings Tab
function addSettingsEnvVarRow(key = '', val = '') {
    const container = document.getElementById('settings-env-vars-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'env-var-row-settings';
    row.style.display = 'flex';
    row.style.gap = '0.5rem';
    row.style.marginBottom = '0.5rem';
    row.style.alignItems = 'center';

    row.innerHTML = `
        <input type="text" placeholder="Açar (Key)" class="env-key" value="${key}" style="flex: 1; padding: 0.6rem 0.8rem; font-size: 0.85rem;" required>
        <input type="text" placeholder="Dəyər (Value)" class="env-value" value="${val}" style="flex: 2; padding: 0.6rem 0.8rem; font-size: 0.85rem;" required>
        <button type="button" onclick="this.parentElement.remove()" style="background: transparent; border: none; color: var(--danger-color); font-size: 1.2rem; cursor: pointer; padding: 0 0.5rem; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">✕</button>
    `;
    container.appendChild(row);
}

function populateSettingsEnvVars(envString) {
    const container = document.getElementById('settings-env-vars-container');
    if (!container) return;
    container.innerHTML = '';
    if (!envString) {
        addSettingsEnvVarRow(); // default empty row
        return;
    }
    const lines = envString.split(/\r?\n/);
    lines.forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            const val = parts.slice(1).join('=').trim();
            if (key) addSettingsEnvVarRow(key, val);
        }
    });
    if (container.children.length === 0) {
        addSettingsEnvVarRow();
    }
}

function getSettingsEnvVarsString() {
    const container = document.getElementById('settings-env-vars-container');
    if (!container) return '';
    const rows = container.querySelectorAll('.env-var-row-settings');
    const vars = [];
    rows.forEach(row => {
        const key = row.querySelector('.env-key').value.trim();
        const val = row.querySelector('.env-value').value.trim();
        if (key && val) {
            vars.push(`${key}=${val}`);
        }
    });
    return vars.join('\n');
}

// Global Tab Switcher Helper
function switchTab(tabId) {
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabSections = document.querySelectorAll('.tab-section');

    navButtons.forEach(b => {
        if (b.getAttribute('data-tab') === tabId) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });

    tabSections.forEach(s => {
        if (s.id === `tab-${tabId}`) {
            s.classList.add('active');
        } else {
            s.classList.remove('active');
        }
    });

    // Persist active tab selection
    localStorage.setItem('active_tab', tabId);

    if (tabId !== 'deployment-logs') {
        stopLogPolling();
    }

    if (document.body.classList.contains('debug-mode')) {
        // Delay slightly to allow transition animations to finish
        setTimeout(updateDebugDimensions, 100);
    }
}

// Koyeb-style Wizard Variables
let wizSelectedSource = '';
let wizSelectedRepo = null; // { full_name, private, clone_url }
let wizSelectedBuildOption = 'buildpack';

function showCreateServiceTab() {
    wizSelectedSource = '';
    wizSelectedRepo = null;
    wizSelectedBuildOption = 'buildpack';

    // Select default buildpack card active class
    document.getElementById('buildpack-card').classList.add('active');
    document.getElementById('dockerfile-card').classList.remove('active');

    // Reset inputs
    document.getElementById('manual-public-repo').value = '';
    document.getElementById('repo-search').value = '';

    goToStep(1);
    switchTab('create-service');
}

function goToStep(step) {
    // Hide all steps
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));

    // Show current step
    const targetStep = document.getElementById(`wizard-step-${step}`);
    if (targetStep) {
        targetStep.classList.add('active');
    }

    // Toggle buildpack vs dockerfile config visibility when going to step 3
    if (step === 3) {
        selectBuildOption(wizSelectedBuildOption || 'buildpack');
    }

    if (document.body.classList.contains('debug-mode')) {
        setTimeout(updateDebugDimensions, 100);
    }
}

function selectSource(source) {
    wizSelectedSource = source;
    if (source === 'github') {
        goToStep(2);
        loadGithubRepos(); // Auto-load repos using token
    } else {
        // Docker selected - skip to step 4 config with Docker adjustments
        wizSelectedRepo = { full_name: 'docker-image', private: false, isDocker: true };
        document.getElementById('wiz-app-name').value = 'my-docker-service';
        document.getElementById('wiz-branch-group').style.display = 'none'; // Docker doesn't need branches

        // Adjust the service label to ask for docker image instead of github URL
        const parent = document.getElementById('wiz-app-name').parentElement;
        // We will just pre-fill wiz-app-name and add another field for Docker Image if needed.
        // For simplicity, we can let user enter name and then we will customize configuration.
        // Let's go to Step 4 directly.
        resetWizEnvVarsContainer();
        loadWizServers();
        goToStep(4);
    }
}

function selectBuildOption(option) {
    wizSelectedBuildOption = option;
    const bpCard = document.getElementById('buildpack-card');
    const dfCard = document.getElementById('dockerfile-card');
    const bpContainer = document.getElementById('wiz-bp-container');
    const dfContainer = document.getElementById('wiz-df-container');

    if (option === 'buildpack') {
        bpCard.classList.add('active');
        dfCard.classList.remove('active');
        bpContainer.style.display = 'block';
        dfContainer.style.display = 'none';
    } else {
        bpCard.classList.remove('active');
        dfCard.classList.add('active');
        bpContainer.style.display = 'none';
        dfContainer.style.display = 'block';
    }
}

// Collapsible Panel Toggler helper
function toggleCollapsible(id, header) {
    const el = document.getElementById(id);
    const arrow = header.querySelector('.arrow-icon');
    if (el.style.display === 'none' || el.style.display === '') {
        el.style.display = 'block';
        arrow.style.transform = 'rotate(90deg)';
        header.style.borderBottomLeftRadius = '0px';
        header.style.borderBottomRightRadius = '0px';
    } else {
        el.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
        header.style.borderBottomLeftRadius = '12px';
        header.style.borderBottomRightRadius = '12px';
    }
}

// Render dynamic repo list
function renderReposList(repos) {
    const reposList = document.getElementById('github-repos-list');
    if (repos.length === 0) {
        reposList.innerHTML = '<div class="no-data">Heç bir repozitoriya tapılmadı</div>';
        return;
    }

    reposList.innerHTML = repos.map(repo => {
        const isPrivate = repo.private;
        const badgeClass = isPrivate ? 'badge-private' : 'badge-public';
        const badgeText = isPrivate ? 'Private' : 'Public';
        return `
            <div class="repo-list-item" onclick="selectRepo('${repo.full_name}', ${isPrivate})">
                <span style="font-weight: 500; font-family: monospace;">🐱 ${repo.full_name}</span>
                <span class="${badgeClass}">${badgeText}</span>
            </div>
        `;
    }).join('');
}

function filterRepos() {
    const searchVal = document.getElementById('repo-search').value.toLowerCase().trim();
    if (!searchVal) {
        renderReposList(gitHubRepos);
        return;
    }
    const filtered = gitHubRepos.filter(r => r.full_name.toLowerCase().includes(searchVal));
    renderReposList(filtered);
}

// Import public repo manually
function importManualRepo() {
    const url = document.getElementById('manual-public-repo').value.trim();
    if (!url) {
        alert("Lütfən public repository URL-i daxil edin!");
        return;
    }
    if (!url.startsWith('http')) {
        alert("Düzgün bir URL daxil edin (məs. https://github.com/owner/repo)!");
        return;
    }

    // Parse owner/repo name
    let name = url.replace('https://github.com/', '').replace('.git', '');
    wizSelectedRepo = { full_name: name, private: false, manualUrl: url };

    document.getElementById('wiz-app-name').value = name.split('/').pop() || 'public-app';
    document.getElementById('wiz-branch-group').style.display = 'block';

    // Populate default branch select option
    document.getElementById('wiz-app-branch').innerHTML = '<option value="main">main</option><option value="master">master</option>';

    resetWizEnvVarsContainer();
    loadWizServers();
    goToStep(3);
}

async function selectRepo(repoFullName, isPrivate) {
    wizSelectedRepo = { full_name: repoFullName, private: isPrivate };

    // Pre-fill app name
    const appName = repoFullName.split('/').pop();
    document.getElementById('wiz-app-name').value = appName;
    document.getElementById('wiz-branch-group').style.display = 'block';

    // Load branches from GitHub API
    const branchSelect = document.getElementById('wiz-app-branch');
    branchSelect.innerHTML = '<option value="">Budaqlar yüklənir...</option>';

    const token = localStorage.getItem('github_token');

    try {
        const res = await fetch(`https://api.github.com/repos/${repoFullName}/branches`, {
            headers: token ? { 'Authorization': `token ${token}` } : {}
        });

        if (res.ok) {
            const branches = await res.json();
            branchSelect.innerHTML = branches.map(b => `<option value="${b.name}">${b.name}</option>`).join('');

            const hasMain = branches.some(b => b.name === 'main');
            const hasMaster = branches.some(b => b.name === 'master');
            if (hasMain) {
                branchSelect.value = 'main';
            } else if (hasMaster) {
                branchSelect.value = 'master';
            }
        } else {
            branchSelect.innerHTML = '<option value="main">main</option><option value="master">master</option>';
        }
    } catch (e) {
        console.error(e);
        branchSelect.innerHTML = '<option value="main">main</option>';
    }

    resetWizEnvVarsContainer();
    loadWizServers();
    goToStep(3);
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

    if (wizSelectedRepo.isDocker) {
        // Docker Deploy support: For now we can mock it or let backend support it.
        // We will just pass a dummy Docker image URL.
        repoUrl = "DOCKER_IMAGE:" + document.getElementById('wiz-app-name').value.trim();
        branch = "latest";
    } else if (wizSelectedRepo.manualUrl) {
        repoUrl = wizSelectedRepo.manualUrl;
        branch = document.getElementById('wiz-app-branch').value;
    } else {
        const token = localStorage.getItem('github_token');
        if (wizSelectedRepo.private && token) {
            repoUrl = `https://${token}@github.com/${wizSelectedRepo.full_name}.git`;
        } else {
            repoUrl = `https://github.com/${wizSelectedRepo.full_name}.git`;
        }
        branch = document.getElementById('wiz-app-branch').value;
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
    };

    try {
        const res = await fetch('/api/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const app = await res.json();
            // Automatically switch back to Applications list
            switchTab('applications');
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
let activeServerId = null;

async function fetchServerStats() {
    // Only fetch if applications tab is active and there's a server we can query
    if (!activeServerId) {
        try {
            const res = await fetch('/api/servers');
            const servers = await res.json();
            if (servers.length > 0) activeServerId = servers[0].id;
        } catch (e) { }
    }

    if (activeServerId && document.getElementById('tab-applications').classList.contains('active')) {
        try {
            const res = await fetch(`/api/servers/${activeServerId}/stats`);
            if (res.ok) {
                const stats = await res.json();
                document.getElementById('server-stats-banner').style.display = 'flex';
                document.getElementById('stat-ram').innerText = `${stats.used_ram_mb} / ${stats.total_ram_mb} MB`;
                document.getElementById('stat-cpu').innerText = `${stats.cores}`;

                // Color warnings
                const ramPercent = stats.used_ram_mb / stats.total_ram_mb;
                if (ramPercent > 0.85) {
                    document.getElementById('stat-ram').style.color = '#ff1744'; // Red
                } else if (ramPercent > 0.6) {
                    document.getElementById('stat-ram').style.color = '#ffb300'; // Orange
                } else {
                    document.getElementById('stat-ram').style.color = '#00e676'; // Green
                }
            }
        } catch (e) {
            console.error("Failed to fetch stats", e);
        }
    }
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
        const res = await fetch(`/api/servers/${serverId}/stats`);
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
        console.error(e);
        advisorDiv.innerHTML = '⚠️ Server məlumatları alına bilmədi. Serverin aktiv olduğuna əmin olun.';
    }
}
let runtimeLogInterval = null;

function stopRuntimeLogPolling() {
    if (runtimeLogInterval) {
        clearInterval(runtimeLogInterval);
        runtimeLogInterval = null;
    }
}

async function fetchRuntimeLogs(appId) {
    try {
        const res = await fetch(`/api/runtime-logs/${appId}`);
        if (res.ok) {
            const logs = await res.json();
            const liveTerminal = document.getElementById('live-terminal-body');
            const isNearBottom = liveTerminal.innerText === '' || liveTerminal.scrollHeight - liveTerminal.scrollTop <= liveTerminal.clientHeight + 50;
            liveTerminal.innerText = stripAnsi(logs);
            if (isNearBottom) {
                liveTerminal.scrollTop = liveTerminal.scrollHeight;
            }
        }
    } catch (e) {
        console.error("Error fetching runtime logs:", e);
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
                // Initial fetch
                fetchRuntimeLogs(currentAppId);
                // Poll every 3 seconds
                if (!runtimeLogInterval) {
                    runtimeLogInterval = setInterval(() => fetchRuntimeLogs(currentAppId), 3000);
                }
            }
        } else {
            stopRuntimeLogPolling();
        }
    }
};

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

async function openAppDetails(appId) {
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
            'building': '#00d2ff', 'cancelled': '#ff9800', 'idle': '#9aa0a6'
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

        const appUrl = `http://${serverIp}:${app.port}`;
        document.getElementById('detail-app-url').innerText = appUrl;
        document.getElementById('detail-app-link').href = appUrl;

        // Populate Overview
        document.getElementById('detail-overview-repo').innerText = app.repo_url || '-';
        document.getElementById('detail-overview-branch').innerText = app.branch || '-';
        document.getElementById('detail-overview-port').innerText = app.port || '-';

        // Populate Settings inputs using existing function but bypassing modal
        openAppSettings(appId, false); // false = don't show modal

        switchTab('app-details');
        switchAppTab('overview');

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

    // Show selected subtab
    const selectedContent = document.getElementById(`subtab-${tabId}`);
    if (selectedContent) selectedContent.style.display = 'block';

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
async function fetchChangelog() {
    try {
        const res = await fetch('/api/system/changelog');
        return await res.json();
    } catch(e) { return []; }
}

async function fetchDocs() {
    try {
        const res = await fetch('/api/system/docs');
        return await res.json();
    } catch(e) { return {}; }
}

let systemVersions = [];
let _currentPanelVersion = '';

// Versiya rəqəmlərini müqayisə üçün çevir (v1.0.19 -> 10019)
function parseVersionNum(v) {
    const clean = v.replace(/^v/, '').replace(/[^0-9.]/g, '');
    const parts = clean.split('.');
    return (parseInt(parts[0] || 0) * 10000) +
           (parseInt(parts[1] || 0) * 100) +
            parseInt(parts[2] || 0);
}

async function initSystemUpdates() {
    const changelog = await fetchChangelog();
    systemVersions = changelog;
    
    try {
        const vRes = await fetch('/api/version');
        const vData = await vRes.json();
        _currentPanelVersion = vData.version;
        const currentNum = parseVersionNum(_currentPanelVersion);
        
        let latestVer = '';
        let hasNewer = false;
        if (changelog.length > 0) {
            latestVer = changelog[0].version;
            if (parseVersionNum(latestVer) > currentNum) {
                hasNewer = true;
            }
        }
        
        // Badge məntiqi — yalnız burada, fetchAppVersion-da deyil
        const badge = document.getElementById('version-badge');
        const versionText = document.getElementById('version-text');
        if (badge) {
            if (hasNewer) {
                badge.innerHTML = `<span onclick="openSystemUpdateModal()" style="background: linear-gradient(135deg, #ff416c, #ff4b2b); color: white; border-radius: 5px; padding: 2px 7px; font-size: 0.52rem; margin-left: 4px; cursor: pointer; font-weight: 700; letter-spacing: 0.5px; box-shadow: 0 2px 8px rgba(255,65,108,0.4); animation: pulse-badge 2s infinite;" title="${latestVer} mövcuddur — klikləyin">UPDATE</span>`;
            } else {
                badge.innerHTML = '';
            }
        }
    } catch(e) {}
}

function openSystemUpdateModal() {
    showModal('system-update-modal');
    renderVersionCards();
}

function renderVersionCards() {
    const container = document.getElementById('version-cards-list');
    if (!container) return;
    if (systemVersions.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-secondary);">Versiya məlumatı tapılmadı.</div>';
        return;
    }
    
    const currentNum = parseVersionNum(_currentPanelVersion);
    const latestNum = parseVersionNum(systemVersions[0].version);
    
    container.innerHTML = systemVersions.map((v, idx) => {
        const vNum = parseVersionNum(v.version);
        const isCurrent = (vNum === currentNum);
        const isLatest = (idx === 0);
        const isNewer = vNum > currentNum;
        const isOlder = vNum < currentNum;
        
        // Kart rəng və border
        let borderColor = 'var(--card-border)';
        let bgColor = 'var(--card-bg)';
        if (isCurrent) {
            borderColor = 'rgba(0, 210, 255, 0.5)';
            bgColor = 'rgba(0, 210, 255, 0.05)';
        } else if (isLatest && isNewer) {
            borderColor = 'rgba(255, 65, 108, 0.4)';
            bgColor = 'rgba(255, 65, 108, 0.05)';
        }
        
        // Badge
        let badgeHtml = '';
        if (isLatest && isNewer) {
            badgeHtml = `<span style="background: linear-gradient(135deg, #ff416c, #ff4b2b); color: white; border-radius: 4px; padding: 2px 8px; font-size: 0.65rem; font-weight: 700;">⭐ Ən Son</span>`;
        } else if (isLatest && isCurrent) {
            badgeHtml = `<span style="background: linear-gradient(135deg, #00c851, #007e33); color: white; border-radius: 4px; padding: 2px 8px; font-size: 0.65rem; font-weight: 700;">⭐ Ən Son</span>`;
        } else if (isCurrent) {
            badgeHtml = `<span style="background: rgba(0,210,255,0.2); color: #00d2ff; border: 1px solid rgba(0,210,255,0.4); border-radius: 4px; padding: 2px 8px; font-size: 0.65rem; font-weight: 600;">✅ Hazırki</span>`;
        }
        
        // Düymə
        let btnHtml = '';
        if (isCurrent) {
            btnHtml = `<button class="btn btn-secondary" disabled style="opacity:0.4; cursor:not-allowed; padding: 6px 14px; font-size: 0.8rem;">Hazırki</button>`;
        } else if (isNewer) {
            btnHtml = `<button class="btn btn-primary" onclick="confirmVersionSwitch('${v.version}', false)" style="padding: 6px 14px; font-size: 0.8rem; background: linear-gradient(135deg, #ff416c, #ff4b2b);">⬆ Yüksəlt</button>`;
        } else {
            btnHtml = `<button class="btn btn-secondary" onclick="confirmVersionSwitch('${v.version}', true)" style="padding: 6px 14px; font-size: 0.8rem;">↩ Qayıt</button>`;
        }
        
        // Changelog sətirləri
        const changesHtml = v.changes && v.changes.length > 0
            ? `<ul style="margin: 8px 0 0; padding-left: 18px; color: var(--text-secondary); font-size: 0.8rem; line-height: 1.6;">${v.changes.map(c => `<li>${c}</li>`).join('')}</ul>`
            : '';
        
        return `
        <div style="
            background: ${bgColor};
            border: 1px solid ${borderColor};
            border-radius: 10px;
            padding: 14px 16px;
            transition: all 0.2s ease;
        ">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-weight: 700; font-size: 1rem; color: var(--text-primary); font-family: monospace;">${v.version}</span>
                    ${badgeHtml}
                </div>
                ${btnHtml}
            </div>
            ${changesHtml}
        </div>`;
    }).join('');
}

async function confirmVersionSwitch(version, isRollback) {
    const versionObj = systemVersions.find(x => x.version === version);
    const action = isRollback ? 'geri qayıtmaq' : 'yüksəltmək';
    const actionLabel = isRollback ? '↩ Qayıt' : '⬆ Yüksəlt';
    
    let bodyHtml = `<strong>${version}</strong> versiyasına ${action} istəyirsiniz.`;
    if (versionObj && versionObj.changes && versionObj.changes.length > 0) {
        bodyHtml += `<br><br><strong>Bu versiyada:</strong><ul style="margin: 6px 0 0; padding-left: 18px;">${versionObj.changes.map(c => `<li>${c}</li>`).join('')}</ul>`;
    }
    
    showConfirmCard({
        icon: isRollback ? '↩' : '⬆️',
        title: isRollback ? 'Köhnə Versiyaya Qayıt' : 'Versiyaya Yüksəlt',
        subtitle: version,
        body: bodyHtml,
        warning: '⚠️ Panel 5-10 saniyə söndürülüb yenidən başladılacaq.',
        confirmText: actionLabel,
        confirmStyle: isRollback ? '' : 'background: linear-gradient(135deg,#ff416c,#ff4b2b);',
        onConfirm: async () => {
            closeModal('system-update-modal');
            
            try {
                addActivityLog(`Versiya keçidi başladılır: ${version}`, 'update');
                const res = await fetch('/api/system/update', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ version: version })
                });

                if (res.ok) {
                    // Pull və proses uğurludur, loading ekranını açırıq
                    showVersionSwitchProgress();
                } else {
                    const errMsg = await res.text();
                    showInfoCard('❌ Keçid Baş tutmadı', 'Docker Pull Xətası', errMsg);
                }
            } catch(e) {
                // Şəbəkə kəsilməsi (fetch-in yarıda qalması) serverin sönməsi deməkdir.
                // Buna görə əgər xəta baş verərsə lakin heç bir HTTP statusu yoxdursa, böyük ehtimal update başlayıb.
                // Ancaq ehtiyat üçün 3 saniyə gözləyib yenidən yoxlama loadingini göstərə bilərik.
                showVersionSwitchProgress();
            }
        }
    });
}

function showVersionSwitchProgress() {
    // Ekranı qarala, gözlə, yenilə
    const overlay = document.createElement('div');
    overlay.id = 'update-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(18,20,30,0.95);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;backdrop-filter:blur(10px);';
    overlay.innerHTML = `
        <div style="text-align:center; color:white;">
            <div class="spin-icon" style="font-size:3.5rem; margin-bottom:1.5rem; display:inline-block;">🔄</div>
            <h2 style="margin:0 0 0.5rem; font-family:'Space Grotesk',sans-serif; font-weight:600; letter-spacing:-0.5px;">Panel Yenilənir...</h2>
            <p style="color:var(--text-secondary); margin:0 0 1.5rem; font-size:0.9rem;">Konteyner yenidən başladılır, zəhmət olmasa gözləyin</p>
            <div style="width:240px; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden; margin:0 auto; box-shadow:var(--shadow-in);">
                <div id="progress-bar" style="width:0%; height:100%; background:linear-gradient(90deg,#00d2ff,#7c3aed); border-radius:3px; transition:width 0.3s; box-shadow: 0 0 10px var(--accent-glow);"></div>
            </div>
            <p id="update-countdown" style="color:var(--text-secondary); font-size:0.8rem; margin-top:1.2rem; font-family:monospace;">10 saniyə...</p>
        </div>
    `;
    document.body.appendChild(overlay);
    
    let secs = 10;
    const interval = setInterval(() => {
        secs--;
        const pct = ((10 - secs) / 10) * 100;
        const bar = document.getElementById('progress-bar');
        const cd = document.getElementById('update-countdown');
        if (bar) bar.style.width = pct + '%';
        if (cd) cd.textContent = secs > 0 ? `${secs} saniyə...` : 'Yenilənir...';
        if (secs <= 0) {
            clearInterval(interval);
            location.reload();
        }
    }, 1000);
}

// Köhnə funksiyalar — uyğunluq üçün saxlanılır
async function quickUpdate(version) {
    await confirmVersionSwitch(version, false);
}
async function confirmSystemUpdate() {
    const select = document.getElementById('system-version-select');
    if (select) await confirmVersionSwitch(select.value, false);
}
function updateSelectedVersionChanges() {}

// ─── Custom Kart Modal (confirm yerine) ───────────────────────────────────────
function showConfirmCard({ icon, title, subtitle, body, warning, confirmText, confirmStyle, onConfirm }) {
    const modal = document.getElementById('confirm-card-modal');
    document.getElementById('confirm-card-icon').textContent = icon || '❓';
    document.getElementById('confirm-card-title').textContent = title || 'Əminsiniz?';
    document.getElementById('confirm-card-subtitle').textContent = subtitle || '';
    document.getElementById('confirm-card-body').innerHTML = body || '';
    
    const warnEl = document.getElementById('confirm-card-warning');
    if (warning) {
        warnEl.style.display = 'block';
        warnEl.textContent = warning;
    } else {
        warnEl.style.display = 'none';
    }
    
    const yesBtn = document.getElementById('confirm-card-yes');
    yesBtn.textContent = confirmText || 'Təsdiqlə';
    yesBtn.style.cssText = `padding: 8px 20px; ${confirmStyle || ''}`;
    
    modal.style.display = 'flex';
    
    const close = () => { modal.style.display = 'none'; };
    yesBtn.onclick = () => { close(); onConfirm && onConfirm(); };
    document.getElementById('confirm-card-no').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
}

function showInfoCard(title, subtitle, body) {
    showConfirmCard({
        icon: 'ℹ️', title, subtitle, body,
        confirmText: 'Bağla',
        confirmStyle: '',
        onConfirm: () => {}
    });
    document.getElementById('confirm-card-no').style.display = 'none';
    setTimeout(() => document.getElementById('confirm-card-no').style.display = '', 100);
}

// ─── Fəaliyyət Jurnalı ─────────────────────────────────────────────────────
const LOG_ICONS = {
    deploy:  { icon: '🚀', color: '#00d2ff' },
    update:  { icon: '🔄', color: '#7c3aed' },
    server:  { icon: '🖥️', color: '#00e676' },
    app:     { icon: '📦', color: '#ff9800' },
    error:   { icon: '❌', color: '#ff1744' },
    info:    { icon: '📋', color: '#9aa0a6' },
    delete:  { icon: '🗑️', color: '#ff1744' },
    setup:   { icon: '⚙️', color: '#00e676' },
};

function addActivityLog(message, type = 'info') {
    const logs = JSON.parse(localStorage.getItem('activity_logs') || '[]');
    const now = new Date();
    const timeStr = now.toLocaleTimeString('az', { hour: '2-digit', minute: '2-digit' });
    logs.unshift({ message, type, time: timeStr });
    if (logs.length > 30) logs.pop();
    localStorage.setItem('activity_logs', JSON.stringify(logs));
    renderActivityLogs();
}

function renderActivityLogs() {
    const container = document.getElementById('activity-log-list');
    if (!container) return;
    const logs = JSON.parse(localStorage.getItem('activity_logs') || '[]');
    if (logs.length === 0) {
        container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); text-align: center; padding: 20px; opacity: 0.5;">Hərəkət qeydə alınmayıb</div>';
        return;
    }
    container.innerHTML = logs.map(l => {
        const meta = LOG_ICONS[l.type] || LOG_ICONS.info;
        return `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:10px; background:rgba(255,255,255,0.02); border: 1px solid var(--card-border); margin-bottom: 2px;">
            <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
                <span style="font-size:1.1rem; flex-shrink:0; display:flex; align-items:center; justify-content:center; width:28px; height:28px; background:rgba(255,255,255,0.03); border-radius:8px;">${meta.icon}</span>
                <div style="flex:1; min-width:0;">
                    <div style="font-size:0.82rem; color:var(--text-primary); font-weight:500; overflow:hidden; text-overflow:ellipsis;" title="${l.message}">${l.message}</div>
                </div>
            </div>
            <span style="font-size:0.75rem; color:var(--text-secondary); font-family:monospace; opacity:0.8; flex-shrink:0;">${l.time}</span>
        </div>`;
    }).join('');
}

function clearActivityLogs() {
    localStorage.removeItem('activity_logs');
    renderActivityLogs();
}

async function openHelpCenter() {
    showModal('help-modal');
    switchHelpTab('help-changelog');
    
    const clog = document.getElementById('help-changelog');
    clog.innerHTML = 'Yüklənir...';
    if(systemVersions.length === 0) systemVersions = await fetchChangelog();
    clog.innerHTML = systemVersions.map(v => `<div style="margin-bottom: 20px;">
        <h3 style="margin-bottom:10px; color:var(--primary-color);">${v.version}</h3>
        <ul style="padding-left:20px; color:var(--text-secondary); line-height:1.6;">
            ${v.changes.map(c => `<li>${c}</li>`).join('')}
        </ul>
    </div>`).join('<hr style="border:0; border-top:1px solid var(--card-border); margin:15px 0;">');
    
    const docs = await fetchDocs();
    document.getElementById('help-about').innerText = docs.proqram_haqqinda || '';
    document.getElementById('help-external').innerText = docs.xarici_server || '';
    document.getElementById('help-local').innerText = docs.lokal_server || '';
}

function switchHelpTab(tabId) {
    document.querySelectorAll('.help-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.help-tab-btn').forEach(el => {
        el.style.color = 'var(--text-secondary)';
        el.style.borderBottom = '2px solid transparent';
    });
    
    document.getElementById(tabId).style.display = 'block';
    const activeBtn = Array.from(document.querySelectorAll('.help-tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
    if(activeBtn) {
        activeBtn.style.color = 'var(--text-primary)';
        activeBtn.style.borderBottom = '2px solid var(--primary-color)';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initSystemUpdates();
    // Hər 5 dəqiqədən bir versiya yoxla
    setInterval(initSystemUpdates, 5 * 60 * 1000);
});

// Pulse animasiyası badge üçün
const _badgeStyle = document.createElement('style');
_badgeStyle.textContent = `
@keyframes pulse-badge {
    0%, 100% { box-shadow: 0 2px 8px rgba(255,65,108,0.4); }
    50% { box-shadow: 0 2px 16px rgba(255,65,108,0.8); }
}
`;
document.head.appendChild(_badgeStyle);
