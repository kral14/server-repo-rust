// ══════════════════════════════════════════════════════════════════
// AĞILLI AUTO-DEPLOY VƏ ARXA PLAN TƏTBİQLƏRİNİN İDARƏETMƏ MƏRKƏZİ
// ══════════════════════════════════════════════════════════════════
let autoDeployAppsList = [];
let autoDeployCurrentFilter = 'all';

async function loadAutoDeployCenter() {
    const container = document.getElementById('autodeploy-cards-container');
    if (!container) return;

    container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; color: var(--text-secondary);">
            <div style="display: inline-block; animation: spin 1s linear infinite; margin-bottom: 0.5rem;">🔄</div>
            <div>Bütün layihələrin və arxa plan servislərinin statusları oxunur...</div>
        </div>
    `;

    try {
        const res = await fetch('/api/applications/autodeploy-list');
        if (!res.ok) throw new Error('Məlumatları almaq mümkün olmadı');
        autoDeployAppsList = await res.json();
        renderAutoDeployCenter();
    } catch (e) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2.5rem; color: #ff5252;">
                Xəta baş verdi: ${e.message}
            </div>
        `;
    }
}

function setAutoDeployFilter(filter, btn) {
    autoDeployCurrentFilter = filter;
    document.querySelectorAll('.ad-filter-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'rgba(255,255,255,0.04)';
        b.style.borderColor = 'rgba(255,255,255,0.08)';
    });
    if (btn) {
        btn.classList.add('active');
        btn.style.background = 'rgba(56, 189, 248, 0.15)';
        btn.style.borderColor = 'rgba(56, 189, 248, 0.3)';
    }
    renderAutoDeployCenter();
}

function filterAutoDeployList() {
    renderAutoDeployCenter();
}

function renderAutoDeployCenter() {
    const container = document.getElementById('autodeploy-cards-container');
    if (!container) return;

    const searchTerm = (document.getElementById('ad-search-input')?.value || '').toLowerCase().trim();

    // Stats
    const totalCount = autoDeployAppsList.length;
    const enabledCount = autoDeployAppsList.filter(a => Number(a.auto_deploy_enabled) === 1).length;
    const disabledCount = totalCount - enabledCount;

    const statTotalEl = document.getElementById('ad-stat-total');
    const statEnabledEl = document.getElementById('ad-stat-enabled');
    const statDisabledEl = document.getElementById('ad-stat-disabled');
    if (statTotalEl) statTotalEl.innerText = totalCount;
    if (statEnabledEl) statEnabledEl.innerText = enabledCount;
    if (statDisabledEl) statDisabledEl.innerText = disabledCount;

    // Filter
    let filtered = autoDeployAppsList.filter(app => {
        const matchesSearch = app.name.toLowerCase().includes(searchTerm) || 
                              (app.registry_image && app.registry_image.toLowerCase().includes(searchTerm)) ||
                              (app.repo_url && app.repo_url.toLowerCase().includes(searchTerm));

        if (!matchesSearch) return false;

        const isEnabled = Number(app.auto_deploy_enabled) === 1;
        if (autoDeployCurrentFilter === 'active') return isEnabled;
        if (autoDeployCurrentFilter === 'inactive') return !isEnabled;
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem; background: rgba(15, 23, 42, 0.3); border: 1px dashed var(--card-border); border-radius: 12px; color: var(--text-secondary);">
                Heç bir tətbiq və ya servis tapılmadı.
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(app => {
        const isEnabled = Number(app.auto_deploy_enabled) === 1;
        const isSystemService = app.deploy_type === 'system_service' || app.id.startsWith('sys-');
        const isImage = app.deploy_type === 'image';
        const interval = app.auto_deploy_interval || 15;
        const timeout = app.auto_deploy_timeout || 10;
        const lastCheck = app.last_auto_deploy_check || 'Hələ yoxlanılmayıb';

        let typeBadge = '';
        if (isSystemService) {
            typeBadge = `<span style="font-size:0.72rem; padding: 2px 7px; border-radius: 4px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 600; border: 1px solid rgba(245, 158, 11, 0.25); display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="shield" style="width: 12px; height: 12px;"></i> Sistem Servisi</span>`;
        } else if (isImage) {
            typeBadge = `<span style="font-size:0.72rem; padding: 2px 7px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; border: 1px solid rgba(56, 189, 248, 0.25); display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="container" style="width: 12px; height: 12px;"></i> Docker Image</span>`;
        } else {
            typeBadge = `<span style="font-size:0.72rem; padding: 2px 7px; border-radius: 4px; background: rgba(168, 85, 247, 0.15); color: #c084fc; font-weight: 600; border: 1px solid rgba(168, 85, 247, 0.25); display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="git-branch" style="width: 12px; height: 12px;"></i> Git Repo (${app.branch || 'main'})</span>`;
        }

        const roleBadge = isSystemService 
            ? `<span style="font-size:0.72rem; padding: 2px 7px; border-radius: 4px; background: rgba(234, 179, 8, 0.15); color: #facc15; font-weight: 600; border: 1px solid rgba(234, 179, 8, 0.25); display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="cpu" style="width: 12px; height: 12px;"></i> Arxa Plan Modulu</span>`
            : `<span style="font-size:0.72rem; padding: 2px 7px; border-radius: 4px; background: rgba(52, 211, 153, 0.12); color: #34d399; font-weight: 600; border: 1px solid rgba(52, 211, 153, 0.25); display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="sparkles" style="width: 12px; height: 12px;"></i> Tətbiq</span>`;

        const sourceAddress = isSystemService
            ? (app.registry_image || app.repo_url || 'Sistem nüvə xidməti')
            : (isImage ? (app.registry_image || 'Təyin edilməyib') : (app.repo_url || 'Repo linki yoxdur'));

        let mainIcon = '<i data-lucide="rocket" style="width: 22px; height: 22px; color: #f43f5e;"></i>';
        if (isSystemService) {
            mainIcon = app.id.includes('tunnel') 
                ? '<i data-lucide="cloud" style="width: 22px; height: 22px; color: #f59e0b;"></i>' 
                : '<i data-lucide="trash-2" style="width: 22px; height: 22px; color: #34d399;"></i>';
        } else if (isImage) {
            mainIcon = '<i data-lucide="container" style="width: 22px; height: 22px; color: #38bdf8;"></i>';
        }

        return `
            <div class="item-card" style="background: rgba(15, 23, 42, 0.55); border: 1px solid ${isEnabled ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.06)'}; border-left: 4px solid ${isEnabled ? (isSystemService ? '#f59e0b' : '#38bdf8') : '#64748b'}; border-radius: 12px; padding: 1.1rem 1.3rem; transition: all 0.2s;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                    
                    <!-- Sol: İdentifikasiya -->
                    <div style="display: flex; align-items: center; gap: 1rem; min-width: 250px; flex: 1;">
                        <div style="width: 44px; height: 44px; border-radius: 10px; background: ${isEnabled ? (isSystemService ? 'rgba(245, 158, 11, 0.12)' : 'rgba(56, 189, 248, 0.12)') : 'rgba(255, 255, 255, 0.05)'}; display: flex; align-items: center; justify-content: center; color: ${isEnabled ? '#38bdf8' : '#94a3b8'}; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
                            ${mainIcon}
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                <strong style="font-size: 1rem; color: #fff;">${app.name}</strong>
                                ${roleBadge}
                                ${typeBadge}
                            </div>
                            <div style="font-size: 0.77rem; color: var(--text-secondary); font-family: monospace; max-width: 450px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${sourceAddress}">
                                ${sourceAddress}
                            </div>
                            <div style="font-size: 0.74rem; color: #94a3b8; display: flex; align-items: center; gap: 0.4rem;">
                                <i data-lucide="clock" style="width: 12px; height: 12px; color: #64748b;"></i>
                                <span>Son Yoxlanış: <strong style="color: #cbd5e1;">${lastCheck}</strong></span>
                            </div>
                        </div>
                    </div>

                    <!-- Orta: Sazlamalar (İnterval və Timeout) -->
                    <div style="display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; opacity: ${isEnabled ? '1' : '0.45'}; pointer-events: ${isEnabled ? 'auto' : 'none'};">
                        <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                            <label style="font-size: 0.68rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">
                                İnterval ${isEnabled ? '' : '<span style="color: #ef4444;">(Sönülüdür)</span>'}
                            </label>
                            <select ${isEnabled ? '' : 'disabled'} onchange="updateAppAutoDeployQuick('${app.id}', this.value, null, null)" style="background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.35rem 0.6rem; color: #fff; font-size: 0.78rem;">
                                <option value="5" ${interval == 5 ? 'selected' : ''}>Hər 5 dəqiqə</option>
                                <option value="15" ${interval == 15 ? 'selected' : ''}>Hər 15 dəqiqə</option>
                                <option value="30" ${interval == 30 ? 'selected' : ''}>Hər 30 dəqiqə</option>
                                <option value="60" ${interval == 60 ? 'selected' : ''}>Hər 1 saat</option>
                                <option value="360" ${interval == 360 ? 'selected' : ''}>Hər 6 saat</option>
                                <option value="1440" ${interval == 1440 ? 'selected' : ''}>Hər 24 saat</option>
                            </select>
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                            <label style="font-size: 0.68rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">Limit</label>
                            <select ${isEnabled ? '' : 'disabled'} onchange="updateAppAutoDeployQuick('${app.id}', null, this.value, null)" style="background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 0.35rem 0.6rem; color: #fff; font-size: 0.78rem;">
                                <option value="5" ${timeout == 5 ? 'selected' : ''}>5 saniyə</option>
                                <option value="10" ${timeout == 10 ? 'selected' : ''}>10 saniyə</option>
                                <option value="15" ${timeout == 15 ? 'selected' : ''}>15 saniyə</option>
                                <option value="30" ${timeout == 30 ? 'selected' : ''}>30 saniyə</option>
                                <option value="60" ${timeout == 60 ? 'selected' : ''}>60 saniyə</option>
                            </select>
                        </div>
                    </div>

                    <!-- Sağ: ON/OFF Toggle və İndi Yoxla -->
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 0.2rem;">
                            <label class="md-switch" title="Auto-Deploy aktivləşdir və ya söndür">
                                <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="updateAppAutoDeployQuick('${app.id}', null, null, this.checked ? 1 : 0)">
                                <span class="md-switch-slider"></span>
                            </label>
                            <span style="font-size: 0.68rem; font-weight: 600; color: ${isEnabled ? '#38bdf8' : '#64748b'};">
                                ${isEnabled ? 'Aktiv 🟢' : 'Sönülü ⚪'}
                            </span>
                        </div>

                        <button class="hbtn hbtn-check" onclick="triggerManualDeployCheck('${app.id}', this)" title="Dərhal yoxla" style="padding: 0.45rem 0.85rem; font-size: 0.8rem;">
                            <i data-lucide="scan" style="width: 13px; height: 13px;"></i>
                            <span>İndi Yoxla</span>
                        </button>
                    </div>

                </div>
            </div>
        `;
    }).join('');

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

async function updateAppAutoDeployQuick(appId, interval, timeout, enabled) {
    const payload = {};
    if (interval !== null) payload.auto_deploy_interval = parseInt(interval);
    if (timeout !== null) payload.auto_deploy_timeout = parseInt(timeout);
    if (enabled !== null) payload.auto_deploy_enabled = parseInt(enabled);

    try {
        const res = await fetch(`/api/applications/${appId}/quick-autodeploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showToast('Auto-Deploy tənzimləmələri yeniləndi! ⚡', 'success');
            // Yerli massivdə dərhal yeniləyirik
            const app = autoDeployAppsList.find(a => a.id === appId);
            if (app) {
                if (payload.auto_deploy_interval !== undefined) app.auto_deploy_interval = payload.auto_deploy_interval;
                if (payload.auto_deploy_timeout !== undefined) app.auto_deploy_timeout = payload.auto_deploy_timeout;
                if (payload.auto_deploy_enabled !== undefined) app.auto_deploy_enabled = payload.auto_deploy_enabled;
            }
            renderAutoDeployCenter();
        } else {
            showToast('Tənzimləmə yenilənə bilmədi.', 'error');
        }
    } catch (e) {
        showToast('Xəta baş verdi: ' + e.message, 'error');
    }
}

async function triggerCheckAllAutoDeploy(btn) {
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ Hamısı Yoxlanılır...</span>`;

    try {
        const res = await fetch('/api/applications/check-all-deploy', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            showToast(data.message || 'Bütün aktiv layihələr üçün yoxlama başladıldı! 🚀', 'success');
            setTimeout(loadAutoDeployCenter, 2000);
        } else {
            showToast('Toplu yoxlanış icra edilə bilmədi.', 'error');
        }
    } catch (e) {
        showToast('Xəta baş verdi: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
}

async function checkMasterDeployCoreUpdate(btn) {
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ Yoxlanılır...</span>`;

    const statusEl = document.getElementById('ad-core-status-text');
    const badgeEl = document.getElementById('ad-core-version-badge');

    try {
        await initSystemUpdates();
        const currentNum = parseVersionNum(_currentPanelVersion || '1.0.0');
        if (badgeEl && _currentPanelVersion) {
            badgeEl.innerText = 'v' + _currentPanelVersion;
        }

        if (systemVersions && systemVersions.length > 0) {
            const latestVer = systemVersions[0].version;
            const latestNum = parseVersionNum(latestVer);

            if (latestNum > currentNum) {
                if (statusEl) {
                    statusEl.innerHTML = `<strong style="color: #ff4757;">Yeni versiya mövcuddur: ${latestVer} 🚀</strong> (Yeniləmək üçün 'Bütün Versiyalar' klikləyin)`;
                }
                showToast(`MasterDeploy üçün yeni versiya tapıldı: ${latestVer}!`, 'info');
            } else {
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color: #2ecc71; font-weight:600;">Sistem ən son versiyadadır (${_currentPanelVersion}) ✅</span>`;
                }
                showToast(`MasterDeploy ən son versiyadadır (${_currentPanelVersion})`, 'success');
            }
        } else {
            showToast('Versiya məlumatı oxuna bilmədi.', 'warning');
        }
    } catch (e) {
        showToast('Xəta baş verdi: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
}

// ══════════════════════════════════════════════════════════════════
// ARXA PLAN XİDMƏTLƏRİ VƏ TUNEL WATCHDOG İDARƏETMƏ PANELİ
// ══════════════════════════════════════════════════════════════════

async function loadBackgroundServicesTab() {
    await Promise.all([
        loadBackgroundServicesSettings(),
        loadBackgroundAppsOverview(),
        loadBackgroundActivityLogs()
    ]);
}

async function loadBackgroundServicesSettings() {
    try {
        const res = await fetch('/api/settings/background-services');
        if (!res.ok) return;
        const data = await res.json();

        // Checkboxes & inputs
        const toggleAd = document.getElementById('bg-toggle-autodeploy');
        const toggleAc = document.getElementById('bg-toggle-autoclean');
        const toggleTw = document.getElementById('bg-toggle-tunnel-watchdog');
        const inputDays = document.getElementById('bg-input-autoclean-days');

        if (toggleAd) toggleAd.checked = data.autodeploy_enabled;
        if (toggleAc) toggleAc.checked = data.autoclean_enabled;
        if (toggleTw) toggleTw.checked = data.tunnel_watchdog_enabled;
        if (inputDays) inputDays.value = data.autoclean_days;

        // Badges
        updateBgBadge('bg-badge-autodeploy', data.autodeploy_enabled);
        updateBgBadge('bg-badge-autoclean', data.autoclean_enabled);
        updateBgBadge('bg-badge-tunnel', data.tunnel_watchdog_enabled);
    } catch (e) {
        console.error('Failed to load background services settings:', e);
    }
}

function updateBgBadge(badgeId, isEnabled) {
    const el = document.getElementById(badgeId);
    if (!el) return;
    if (isEnabled) {
        el.innerText = 'Aktiv';
        el.style.background = 'rgba(52, 211, 153, 0.15)';
        el.style.color = '#34d399';
    } else {
        el.innerText = 'Sönülüdür';
        el.style.background = 'rgba(239, 68, 68, 0.15)';
        el.style.color = '#ef4444';
    }
}

async function saveBackgroundServicesSettings() {
    const autodeploy_enabled = document.getElementById('bg-toggle-autodeploy')?.checked ?? true;
    const autoclean_enabled = document.getElementById('bg-toggle-autoclean')?.checked ?? true;
    const tunnel_watchdog_enabled = document.getElementById('bg-toggle-tunnel-watchdog')?.checked ?? true;
    const autoclean_days = parseInt(document.getElementById('bg-input-autoclean-days')?.value || '30', 10);
    const tunnel_watchdog_interval = 2;

    try {
        const res = await fetch('/api/settings/background-services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                autodeploy_enabled,
                autoclean_enabled,
                autoclean_days,
                tunnel_watchdog_enabled,
                tunnel_watchdog_interval
            })
        });

        if (res.ok) {
            showToast('Arxa plan xidmətləri və Tunel Watchdog ayarları uğurla saxlanıldı! ✅', 'success');
            updateBgBadge('bg-badge-autodeploy', autodeploy_enabled);
            updateBgBadge('bg-badge-autoclean', autoclean_enabled);
            updateBgBadge('bg-badge-tunnel', tunnel_watchdog_enabled);
        } else {
            showToast('Ayarları saxlamaq mümkün olmadı.', 'error');
        }
    } catch (e) {
        showToast('Xəta: ' + e.message, 'error');
    }
}

async function triggerCleanNow() {
    if (!confirm('Köhnə deployment qeydlərini indi təmizləmək istəyirsiniz?')) return;
    try {
        const res = await fetch('/api/settings/background-services/clean-now', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            showToast(`Təmizləmə tamamlandı: ${data.deleted_count} köhnə qeyd silindi! 🧹`, 'success');
            loadBackgroundActivityLogs();
        } else {
            showToast('Təmizləmə zamanı xəta baş verdi.', 'error');
        }
    } catch (e) {
        showToast('Xəta: ' + e.message, 'error');
    }
}

async function triggerTunnelCheckNow() {
    showToast('Bütün aktiv tunellər yoxlanılır və lazım gələrsə bərpa edilir... 🔍', 'info');
    try {
        const res = await fetch('/api/settings/background-services/tunnel-check-now', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            showToast(`Tunel yoxlaması başa çatdı! (Yoxlanılan: ${data.checked}, Yenidən qurulan: ${data.repaired}) ✅`, 'success');
            loadBackgroundAppsOverview();
            loadBackgroundActivityLogs();
        } else {
            showToast('Tunel yoxlaması zamanı xəta baş verdi.', 'error');
        }
    } catch (e) {
        showToast('Xəta: ' + e.message, 'error');
    }
}

async function loadBackgroundAppsOverview() {
    const tbody = document.getElementById('bg-apps-table-body');
    if (!tbody) return;

    try {
        const [res, disabledRes] = await Promise.all([
            fetch('/api/applications/autodeploy-list'),
            fetch('/api/settings/background-services/tunnel-watchdog-disabled').catch(() => ({ ok: false }))
        ]);

        if (!res.ok) throw new Error('Layihələr və servislər oxunmadı');
        const apps = await res.json();
        let disabledTunnelApps = [];
        if (disabledRes && disabledRes.ok) {
            try { disabledTunnelApps = await disabledRes.json(); } catch(e) {}
        }

        if (apps.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="padding: 1.5rem; text-align: center; color: var(--text-secondary);">Heç bir layihə tapılmadı.</td></tr>`;
            return;
        }

        tbody.innerHTML = apps.map(app => {
            const isAutoDeploy = Number(app.auto_deploy_enabled) === 1;
            const isSystemService = app.deploy_type === 'system_service' || app.id.startsWith('sys-');
            const hasTunnel = app.cloudflare_url && app.cloudflare_url.length > 5;
            let tunnelLink = '<span style="color: #64748b;">Aktiv deyil</span>';
            if (isSystemService) {
                tunnelLink = app.id.includes('tunnel') 
                    ? `<span style="color: #f59e0b; font-weight: 500;">☁️ Tunel Qoruyucusu</span>`
                    : `<span style="color: #34d399; font-weight: 500;">🧹 Keş & Loq</span>`;
            } else if (hasTunnel) {
                tunnelLink = `<a href="${app.cloudflare_url}" target="_blank" style="color: #38bdf8; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;" title="${app.cloudflare_url}">🔗 ${app.cloudflare_url.replace('https://','').split('.')[0]}...</a>`;
            }

            // Per-project Tunnel Watchdog Switch
            let tunnelWatchdogSwitch = '<span style="color: #64748b;">—</span>';
            if (hasTunnel && !isSystemService) {
                const isWatchdogOff = disabledTunnelApps.includes(app.id);
                tunnelWatchdogSwitch = `
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <label class="md-switch" style="transform: scale(0.8); margin: 0;" title="${isWatchdogOff ? 'Tunel nəzarəti sönülüdür (Avtomatik bərpa olunmur)' : 'Tunel nəzarəti aktivdir (Error 1016 olduqda avtomatik bərpa olunur)'}">
                            <input type="checkbox" ${isWatchdogOff ? '' : 'checked'} onchange="toggleProjectTunnelWatchdog('${app.id}', this)">
                            <span class="md-switch-slider"></span>
                        </label>
                        <span style="font-size: 0.72rem; color: ${isWatchdogOff ? '#64748b' : '#34d399'}; font-weight: 600;">
                            ${isWatchdogOff ? 'Sönülü' : 'Aktiv'}
                        </span>
                    </div>
                `;
            }

            const lastCheckText = app.last_auto_deploy_check 
                ? (app.last_auto_deploy_check.includes('Aktiv') || app.last_auto_deploy_check.includes('Hər') ? app.last_auto_deploy_check : formatTimeAgo(new Date(app.last_auto_deploy_check)))
                : '<span style="color: #64748b;">Yoxlanmayıb</span>';

            const appIcon = isSystemService ? (app.id.includes('tunnel') ? '☁️' : '🧹') : '🚀';
            const typeLabel = isSystemService ? 'SİSTEM SERVİSİ' : (app.deploy_type || 'git').toUpperCase();

            // Interval Display - Əgər auto-deploy deaktivdirsə, istifadəçini çaşdırmamaq üçün "— (Deaktiv)" göstəririk
            const intervalDisplay = isSystemService
                ? `<span style="color: #f59e0b; font-size: 0.76rem;">${app.auto_deploy_interval || 2} dəq</span>`
                : (isAutoDeploy 
                    ? `<span style="color: #38bdf8; font-weight: 500;">${app.auto_deploy_interval || 15} dəq</span>` 
                    : `<span style="color: #64748b;" title="Auto-Deploy sönülü olduğu üçün dövri yoxlanış aparılmır">— (Deaktiv)</span>`);

            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                    <td style="padding: 0.6rem 0.8rem; font-weight: 600; color: #fff;">
                        ${appIcon} ${app.name}
                    </td>
                    <td style="padding: 0.6rem 0.8rem;">
                        <span style="font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; background: ${isSystemService ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.06)'}; color: ${isSystemService ? '#f59e0b' : 'var(--text-secondary)'}; font-weight: ${isSystemService ? '600' : 'normal'};">
                            ${typeLabel}
                        </span>
                    </td>
                    <td style="padding: 0.6rem 0.8rem;">
                        <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 12px; font-weight: 600; background: ${isAutoDeploy ? 'rgba(52, 211, 153, 0.15)' : 'rgba(148, 163, 184, 0.1)'}; color: ${isAutoDeploy ? '#34d399' : '#94a3b8'};">
                            ${isAutoDeploy ? 'Aktiv' : 'Deaktiv'}
                        </span>
                    </td>
                    <td style="padding: 0.6rem 0.8rem;">
                        ${tunnelLink}
                    </td>
                    <td style="padding: 0.6rem 0.8rem;">
                        ${tunnelWatchdogSwitch}
                    </td>
                    <td style="padding: 0.6rem 0.8rem;">
                        ${intervalDisplay}
                    </td>
                    <td style="padding: 0.6rem 0.8rem; font-size: 0.76rem; color: var(--text-secondary);">
                        ${lastCheckText}
                    </td>
                    <td style="padding: 0.6rem 0.8rem; text-align: right;">
                        <button class="btn btn-secondary btn-sm" onclick="triggerBgManualCheck('${app.id}', this)" style="padding: 3px 8px; font-size: 0.72rem;">
                            ⚡ Yoxla
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding: 1.5rem; text-align: center; color: #ef4444;">Xəta: ${e.message}</td></tr>`;
    }
}

async function triggerBgManualCheck(appId, btn) {
    if (btn) {
        btn.disabled = true;
        btn.innerText = '⌛...';
    }
    try {
        if (typeof triggerManualDeployCheck === 'function') {
            await triggerManualDeployCheck(appId);
        } else {
            await fetch(`/api/applications/${appId}/check-deploy`, { method: 'POST' });
        }
        setTimeout(loadBackgroundAppsOverview, 1500);
        setTimeout(loadBackgroundActivityLogs, 1500);
    } catch (e) {
        showToast('Yoxlanış zamanı xəta: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '⚡ Yoxla';
        }
    }
}

async function toggleProjectTunnelWatchdog(appId, checkbox) {
    try {
        const res = await fetch(`/api/settings/background-services/tunnel-watchdog-toggle/${appId}`, {
            method: 'POST'
        });
        if (!res.ok) throw new Error('Tunel nəzarət statusunu dəyişmək olmadı');
        const data = await res.json();
        if (data.disabled) {
            showToast('Bu layihə üçün Tunel Watchdog söndürüldü (avtomatik bərpa edilməyəcək) ⚪', 'info');
        } else {
            showToast('Bu layihə üçün Tunel Watchdog aktivləşdirildi (Error 1016 olduqda bərpa ediləcək) 🟢', 'success');
        }
        setTimeout(loadBackgroundAppsOverview, 300);
        setTimeout(loadBackgroundActivityLogs, 500);
    } catch (e) {
        showToast('Xəta: ' + e.message, 'error');
        if (checkbox) checkbox.checked = !checkbox.checked;
    }
}

async function loadBackgroundActivityLogs() {
    const container = document.getElementById('bg-activity-logs-container');
    if (!container) return;

    try {
        const res = await fetch('/api/activity-logs');
        if (!res.ok) return;
        const logs = await res.json();

        if (logs.length === 0) {
            container.innerHTML = `<div style="color: var(--text-secondary);">Hələ heç bir fəaliyyət loqu qeydə alınmayıb.</div>`;
            return;
        }

        container.innerHTML = logs.slice(0, 40).map(log => {
            let color = '#38bdf8';
            if (log.log_type === 'warning') color = '#f59e0b';
            if (log.log_type === 'error') color = '#ef4444';
            if (log.log_type === 'success') color = '#34d399';

            return `
                <div style="display: flex; gap: 8px; align-items: baseline; line-height: 1.4;">
                    <span style="color: #64748b; font-size: 0.72rem; flex-shrink: 0;">[${log.created_at || 'indi'}]</span>
                    <span style="color: ${color}; font-weight: 600; flex-shrink: 0;">[${(log.module || 'SİSTEM').toUpperCase()}]:</span>
                    <span style="color: #e2e8f0;">${log.message}</span>
                </div>
            `;
        }).join('');
    } catch (e) {
        container.innerHTML = `<div style="color: #ef4444;">Loqları oxumaq mümkün olmadı: ${e.message}</div>`;
    }
}

// --- Vahid Arxa Plan və Avtomatlaşdırma Mərkəzi Alt-Tab İdarəsi ---
let currentBgSubTab = 'autodeploy';

function switchBgSubTab(tabName) {
    currentBgSubTab = tabName;
    
    // Düymələrin aktivliyini yenilə
    ['autodeploy', 'watchdog', 'logs'].forEach(t => {
        const btn = document.getElementById(`bg-subtab-btn-${t}`);
        const content = document.getElementById(`bg-content-${t}`);
        if (btn) btn.classList.toggle('active', t === tabName);
        if (content) content.style.display = (t === tabName) ? 'block' : 'none';
    });

    const primaryBtn = document.getElementById('btn-bg-action-primary');
    const primaryTxt = document.getElementById('txt-bg-action-primary');

    if (tabName === 'autodeploy') {
        if (primaryBtn) primaryBtn.style.display = 'flex';
        if (primaryTxt) primaryTxt.innerText = '⚡ Hamısını İndi Yoxla';
        if (typeof loadAutoDeployCenter === 'function') loadAutoDeployCenter();
    } else if (tabName === 'watchdog') {
        if (primaryBtn) primaryBtn.style.display = 'flex';
        if (primaryTxt) primaryTxt.innerText = '💾 Ayarları Saxla';
        if (typeof loadBackgroundServicesTab === 'function') loadBackgroundServicesTab();
    } else if (tabName === 'logs') {
        if (primaryBtn) primaryBtn.style.display = 'none';
        if (typeof loadBackgroundActivityLogs === 'function') loadBackgroundActivityLogs();
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

function refreshActiveBgTab() {
    if (currentBgSubTab === 'autodeploy') {
        if (typeof loadAutoDeployCenter === 'function') loadAutoDeployCenter();
    } else if (currentBgSubTab === 'watchdog') {
        if (typeof loadBackgroundServicesTab === 'function') loadBackgroundServicesTab();
    } else if (currentBgSubTab === 'logs') {
        if (typeof loadBackgroundActivityLogs === 'function') loadBackgroundActivityLogs();
    }
}

function triggerActiveBgAction(btn) {
    if (currentBgSubTab === 'autodeploy') {
        if (typeof triggerCheckAllAutoDeploy === 'function') triggerCheckAllAutoDeploy(btn);
    } else if (currentBgSubTab === 'watchdog') {
        if (typeof saveBackgroundServicesSettings === 'function') saveBackgroundServicesSettings();
    }
}



