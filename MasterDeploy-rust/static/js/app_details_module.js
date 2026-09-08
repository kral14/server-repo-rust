// Server Stats fetching logic
let serverStatsCache = {};

async function fetchServerStats() {
    const tabApps = document.getElementById('tab-applications');
    if (!tabApps || !tabApps.classList.contains('active')) {
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
    advisorDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: #94a3b8;">
            <svg class="spin-icon" style="width: 14px; height: 14px; stroke: #00d2ff; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <span>Serverin boş resursları yoxlanılır...</span>
        </div>
    `;

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
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg style="width: 13px; height: 13px; stroke: #00d2ff; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                        <span style="color: #f1f5f9; font-weight: 500; font-size: 0.82rem;">Serverin Cari Vəziyyəti:</span>
                    </div>
                    <div style="font-size: 0.78rem; color: #94a3b8; display: flex; gap: 12px; flex-wrap: wrap;">
                        <span>Boş RAM: <strong style="color: #00e676; font-weight: 500;">${freeRam} MB</strong> (Cəmi: ${stats.total_ram_mb} MB)</span>
                        <span>Nüvə: <strong style="color: #f1f5f9; font-weight: 500;">${stats.cores} Core</strong></span>
                    </div>
                    <div style="font-size: 0.74rem; color: #64748b; margin-top: 1px;">
                        Tövsiyə olunan limit: <strong style="color: #cbd5e1; font-weight: 500;">${recommendedRam}</strong> RAM, <strong style="color: #cbd5e1; font-weight: 500;">${recommendedCpu}</strong> CPU
                    </div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" style="padding: 0.35rem 0.85rem; font-size: 0.75rem; font-weight: 500; border: 1px solid rgba(0,210,255,0.3); color: #00d2ff; background: rgba(0,210,255,0.06); border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='rgba(0,210,255,0.15)'" onmouseout="this.style.background='rgba(0,210,255,0.06)'" onclick="
                    document.getElementById('${memInputId}').value = '${recommendedRam}';
                    document.getElementById('${cpuInputId}').value = '${recommendedCpu}';
                ">Tövsiyəni Tətbiq Et</button>
            </div>
        `;
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(e);
        }
        advisorDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: #fbbf24;">
                <svg style="width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17"/></svg>
                <span>Server məlumatları alına bilmədi. Serverin aktiv olduğuna əmin olun.</span>
            </div>
        `;
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
    console.time("[TIMER] openAppDetails TOTAL");
    console.log("[DEBUG] openAppDetails started for App:", appId);
    localStorage.setItem('active_app_id', appId);
    currentAppDetailsId = appId;
    try {
        console.time("[FETCH] Application Details");
        const res = await fetch(`/api/applications/${appId}`);
        console.timeEnd("[FETCH] Application Details");
        
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
            console.time("[FETCH] Server Details");
            const srvRes = await fetch(`/api/servers/${app.server_id}`);
            if (srvRes.ok) {
                const srv = await srvRes.json();
                serverIp = srv.ip;
                document.getElementById('detail-overview-server').innerText = srv.name + ' (' + srv.ip + ')';
            } else {
                document.getElementById('detail-overview-server').innerText = app.server_id;
            }
            console.timeEnd("[FETCH] Server Details");
        } catch (e) {
            console.timeEnd("[FETCH] Server Details");
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

        // Populate Auto-Deploy Overview
        const adToggleEl = document.getElementById('overview-autodeploy-toggle');
        if (adToggleEl) {
            adToggleEl.checked = app.auto_deploy_enabled === 1;
        }
        const adStatusEl = document.getElementById('detail-overview-autodeploy-status');
        if (adStatusEl) {
            if (app.auto_deploy_enabled === 1) {
                adStatusEl.innerHTML = '<span style="color: #00e676; display: inline-flex; align-items: center; gap: 4px;"><span style="width:7px;height:7px;border-radius:50%;background:#00e676;display:inline-block;"></span> Aktivdir</span>';
            } else {
                adStatusEl.innerHTML = '<span style="color: #94a3b8; display: inline-flex; align-items: center; gap: 4px;"><span style="width:7px;height:7px;border-radius:50%;background:#64748b;display:inline-block;"></span> Sönülüdür ⚪</span>';
            }
        }
        const adIntervalEl = document.getElementById('detail-overview-autodeploy-interval');
        if (adIntervalEl) {
            const intVal = app.auto_deploy_interval || 15;
            adIntervalEl.innerText = intVal >= 60 ? `${Math.round(intVal / 60)} saat` : `${intVal} dəqiqə`;
        }
        const adTimeoutEl = document.getElementById('detail-overview-autodeploy-timeout');
        if (adTimeoutEl) {
            adTimeoutEl.innerText = `${app.auto_deploy_timeout || 10} saniyə`;
        }
        const adLastEl = document.getElementById('detail-overview-autodeploy-last');
        if (adLastEl) {
            adLastEl.innerText = app.last_auto_deploy_check ? app.last_auto_deploy_check : 'Hələ yoxlanılmayıb';
        }

        // Populate Settings inputs using existing function but bypassing modal
        console.time("[CALL] openAppSettings");
        openAppSettings(appId, false); // false = don't show modal
        console.timeEnd("[CALL] openAppSettings");

        // Pending redeploy bayrağını yoxla
        const hasPending = localStorage.getItem(`pending_redeploy_${appId}`) === 'true';
        markRedeployPending(hasPending);

        // Deployments tarixçəsini yüklə
        console.time("[CALL] loadAppDeployments");
        loadAppDeployments(appId);
        console.timeEnd("[CALL] loadAppDeployments");

        switchTab('app-details');
        if (autoSwitchToOverview) {
            switchAppTab('overview');
        }

        // Re-render Lucide icons (some may be inside hidden sections)
        if (typeof lucide !== 'undefined') lucide.createIcons();

    } catch (e) {
        console.error("openAppDetails error", e);
    }
    console.timeEnd("[TIMER] openAppDetails TOTAL");
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

function handleDeleteAppClick(event, appId, encodedName) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const appName = encodedName ? decodeURIComponent(encodedName) : 'Adsız Layihə';
    deleteApp(appId, appName);
}

function deleteAppFromDetails() {
    if (!currentAppDetailsId) return;
    const appName = currentAppDetailsName || 'Tətbiq';
    deleteApp(currentAppDetailsId, appName);
}

// ── Actions dropdown (More menu) ──────────────────────
function toggleActionsMenu() {
    const menu = document.getElementById('app-actions-dropdown');
    if (menu) menu.classList.toggle('open');
}
function closeActionsMenu() {
    const menu = document.getElementById('app-actions-dropdown');
    if (menu) menu.classList.remove('open');
}
// Close dropdown if user clicks outside of it
document.addEventListener('click', function(e) {
    const btn  = document.getElementById('btn-more-actions');
    const menu = document.getElementById('app-actions-dropdown');
    if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('open');
    }
});

// ── Initialize Lucide icons after DOM is ready ────────
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
});



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


// ── App Settings Modal Functions ──
// ============================================================
// App Settings Modal Functions
// ============================================================

let currentSettingsAppId = null;


async function openAppSettings(appId, showModalBool = true) {
    console.time("  -> openAppSettings TOTAL");
    currentSettingsAppId = appId;
    try {
        console.time("  -> [FETCH] openAppSettings application");
        const res = await fetch(`/api/applications/${appId}`);
        console.timeEnd("  -> [FETCH] openAppSettings application");
        
        if (!res.ok) { alert('Layihə məlumatları yüklənmədi.'); return; }
        const app = await res.json();

        if (githubToken && gitHubRepos.length === 0) {
            console.time("  -> [CALL] loadGithubRepos");
            loadGithubRepos();
            console.timeEnd("  -> [CALL] loadGithubRepos");
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
            const badge = document.getElementById('settings-autodeploy-badge');
            if (badge) {
                badge.innerText = autoEnabledEl.checked ? 'Aktivdir' : 'Sönülüdür';
                badge.style.color = autoEnabledEl.checked ? '#38bdf8' : '#94a3b8';
                badge.style.background = autoEnabledEl.checked ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.15)';
            }
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
    console.timeEnd("  -> openAppSettings TOTAL");
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
            // Overview ekranını və cari məlumatları yenilə
            if (typeof openAppDetails === 'function') {
                openAppDetails(appId, false);
            }
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

function handleAutoDeployToggleChange(checked) {
    const badge = document.getElementById('settings-autodeploy-badge');
    if (badge) {
        badge.innerText = checked ? 'Aktivdir' : 'Sönülüdür';
        badge.style.color = checked ? '#38bdf8' : '#94a3b8';
        badge.style.background = checked ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.15)';
    }
}

async function quickToggleAutoDeploy(checked) {
    const appId = currentAppDetailsId || currentAppId || currentSettingsAppId;
    if (!appId) {
        alert("Layihə tapılmadı!");
        return;
    }
    try {
        const res = await fetch(`/api/applications/${appId}`);
        if (!res.ok) return;
        const app = await res.json();
        app.auto_deploy_enabled = checked ? 1 : 0;
        
        const updateRes = await fetch(`/api/applications/${appId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(app)
        });
        
        if (updateRes.ok) {
            // Sazlamalar səhifəsindəki switch və badge-i də sinxronlaşdır
            const settingsSwitch = document.getElementById('settings-autodeploy-enabled');
            if (settingsSwitch) {
                settingsSwitch.checked = checked;
                handleAutoDeployToggleChange(checked);
            }
            // Overview statusunu dərhal vizual yenilə
            const adStatusEl = document.getElementById('detail-overview-autodeploy-status');
            if (adStatusEl) {
                if (checked) {
                    adStatusEl.innerHTML = '<span style="color: #00e676; display: inline-flex; align-items: center; gap: 4px;"><span style="width:7px;height:7px;border-radius:50%;background:#00e676;display:inline-block;"></span> Aktivdir</span>';
                } else {
                    adStatusEl.innerHTML = '<span style="color: #94a3b8; display: inline-flex; align-items: center; gap: 4px;"><span style="width:7px;height:7px;border-radius:50%;background:#64748b;display:inline-block;"></span> Sönülüdür ⚪</span>';
                }
            }
            showToast(checked ? '✅ Auto-Deploy aktivləşdirildi!' : '⚪ Auto-Deploy söndürüldü!', 'info');
        } else {
            alert('Statusu dəyişmək mümkün olmadı.');
        }
    } catch (e) {
        console.error('quickToggleAutoDeploy error', e);
        alert('Serverlə əlaqə xətası: ' + e);
    }
}

// ============================================================
// Auto-Deploy: Manual Check Trigger (⚡ İndi Yoxla)
// ============================================================
let isManualDeployChecking = false;

async function triggerManualDeployCheck(appId) {
    if (!appId) {
        appId = currentSettingsAppId || currentAppId || currentAppDetailsId;
    }
    if (!appId) {
        showToast('Zəhmət olmasa yoxlamaq üçün layihə seçin.', 'warning');
        return;
    }
    if (isManualDeployChecking) {
        showToast('Yoxlanış artıq aparılır, zəhmət olmasa gözləyin...', 'info');
        return;
    }

    isManualDeployChecking = true;

    // UI Düyməsinin vəziyyətini dəyişirik
    const checkBtns = [document.getElementById('btn-app-check-deploy')];
    const originalTexts = [];

    checkBtns.forEach(btn => {
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.style.cursor = 'not-allowed';
            const txtEl = btn.querySelector('#btn-app-check-deploy-text') || btn;
            originalTexts.push({ btn, html: btn.innerHTML });
            btn.innerHTML = `<svg class="spin-icon" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;animation:spin 1s linear infinite;" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>Yoxlanılır...</span>`;
        }
    });

    showToast('🔎 Auto-Deploy yoxlanışı başladı... Cavab gözlənilir.', 'info');

    try {
        const res = await fetch(`/api/applications/${appId}/check-deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (res.ok) {
            const data = await res.json();
            if (data.status === 'new_version') {
                showToast(`🚀 ${data.message}`, 'success');
            } else if (data.status === 'up_to_date') {
                showToast(`✅ ${data.message}`, 'success');
            } else if (data.status === 'timeout') {
                showToast(`⏳ ${data.message}`, 'warning');
            } else {
                showToast(`⚠️ ${data.message || 'Yoxlanış başa çatdı.'}`, 'warning');
            }
        } else {
            const errText = await res.text();
            showToast(`❌ Yoxlama xətası: ${errText}`, 'error');
        }

        // Fəaliyyət jurnalını və Overview detallarını yeniləyirik
        if (typeof renderActivityLogs === 'function') {
            renderActivityLogs();
        }
        // Əgər app details açıqdırsa məlumatları yenidən yükləyirik
        if (typeof openAppDetails === 'function' && currentAppDetailsId === appId) {
            openAppDetails(appId, false);
        }

    } catch (e) {
        console.error('triggerManualDeployCheck error', e);
        showToast(`❌ Şəbəkə xətası: ${e.message}`, 'error');
    } finally {
        // Təhlükəsizlik üçün ən azı 3 saniyə düyməni blokda saxlayırıq
        setTimeout(() => {
            isManualDeployChecking = false;
            originalTexts.forEach(item => {
                if (item.btn) {
                    item.btn.disabled = false;
                    item.btn.style.opacity = '1';
                    item.btn.style.cursor = 'pointer';
                    item.btn.innerHTML = item.html;
                }
            });
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }, 3000);
    }
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
    try {
        const res = await fetch('/api/settings/github-token');
        if (res.ok) {
            const data = await res.json();
            githubToken = data.token || '';
            if (githubToken) {
                const ghInput = document.getElementById('gh-token');
                if (ghInput) ghInput.value = githubToken;
                verifyGithubToken(githubToken);
            }
        }
    } catch (e) {
        console.error("Failed to load GitHub token", e);
    }
}

async function saveGithubToken() {
    const ghInput = document.getElementById('gh-token');
    const token = ghInput ? ghInput.value.trim() : '';
    try {
        const res = await fetch('/api/settings/github-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        if (res.ok) {
            githubToken = token;
            if (!token) {
                const statusEl = document.getElementById('gh-status');
                if (statusEl) {
                    statusEl.innerText = "Məlumat yoxdur";
                    statusEl.style.color = "#94a3b8";
                }
                const repoSel = document.getElementById('app-repo-select');
                if (repoSel) repoSel.innerHTML = '<option value="">Token quraşdırılmayıb</option>';
                gitHubRepos = [];
            } else {
                verifyGithubToken(token);
            }
        } else {
            showInfoCard("❌ Xəta", "GitHub tokeni yadda saxlanıla bilmədi.");
        }
    } catch (e) {
        console.error("Failed to save GitHub token", e);
        showInfoCard("❌ Xəta", "Serverlə əlaqə qurulmadı.", e.message);
    }
}

async function verifyGithubToken(token) {
    const statusText = document.getElementById('gh-status');
    if (statusText) {
        statusText.innerText = "Yoxlanılır...";
        statusText.style.color = "#00d2ff";
    }

    try {
        const res = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `token ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            if (statusText) {
                statusText.innerText = `Qoşulub: @${user.login} ✅`;
                statusText.style.color = "#00e676";
            }
            if (typeof activeSourceMode !== 'undefined' && activeSourceMode === 'github') {
                loadGithubRepos();
            }
            // Auto close modal after successful save
            setTimeout(() => {
                closeModal('github-modal');
            }, 1000);
        } else {
            if (statusText) {
                statusText.innerText = "Token səhvdir ❌";
                statusText.style.color = "#ff1744";
            }
        }
    } catch (e) {
        if (statusText) {
            statusText.innerText = "Bağlantı xətası ❌";
            statusText.style.color = "#ff1744";
        }
    }
}

async function loadGithubRepos() {
    const token = githubToken;
    const repoSelect = document.getElementById('app-repo-select');
    const settingsRepoSelect = document.getElementById('settings-repo-select');
    const wizardReposList = document.getElementById('github-repos-list');

    if (repoSelect) {
        if (!token) {
            repoSelect.innerHTML = '<option value="">Öncə GitHub Token daxil edin</option>';
        } else {
            repoSelect.innerHTML = '<option value="">Repolar yüklənir...</option>';
        }
    }

    if (settingsRepoSelect) {
        if (!token) {
            settingsRepoSelect.innerHTML = '<option value="">Öncə GitHub Token daxil edin</option>';
        } else {
            settingsRepoSelect.innerHTML = '<option value="">Repolar yüklənir...</option>';
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

            const optionsHtml = '<option value="">Repozitoriya seçin...</option>' +
                gitHubRepos.map(repo => {
                    const isPrivate = repo.private ? "🔒" : "🔓";
                    return `<option value="${repo.full_name}" data-private="${repo.private}">${isPrivate} ${repo.full_name}</option>`;
                }).join('');

            if (repoSelect) {
                repoSelect.innerHTML = optionsHtml;
            }

            if (settingsRepoSelect) {
                settingsRepoSelect.innerHTML = optionsHtml;
            }

            // Populate custom searchable list
            renderSettingsRepoList(gitHubRepos);
            if (currentSettingsAppId) {
                const repoUrlInput = document.getElementById('settings-repo-url');
                if (repoUrlInput && repoUrlInput.value) {
                    let repoNameOnly = repoUrlInput.value.replace('https://github.com/', '').replace('https://', '');
                    if (repoNameOnly.endsWith('.git')) {
                        repoNameOnly = repoNameOnly.slice(0, -4);
                    }
                    const searchInput = document.getElementById('settings-repo-search');
                    if (searchInput) {
                        searchInput.value = repoNameOnly || '';
                    }
                }
            }

            if (wizardReposList) {
                renderReposList(gitHubRepos);
            }
        } else {
            if (repoSelect) repoSelect.innerHTML = '<option value="">Repoları yükləmək alınmadı ❌</option>';
            if (settingsRepoSelect) settingsRepoSelect.innerHTML = '<option value="">Repoları yükləmək alınmadı ❌</option>';
            if (wizardReposList) wizardReposList.innerHTML = '<div class="no-data" style="color: var(--danger-color);">Repoları yükləmək alınmadı ❌</div>';
        }
    } catch (e) {
        console.error(e);
        if (repoSelect) repoSelect.innerHTML = '<option value="">Bağlantı xətası ❌</option>';
        if (settingsRepoSelect) settingsRepoSelect.innerHTML = '<option value="">Bağlantı xətası ❌</option>';
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
    const token = githubToken;

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
