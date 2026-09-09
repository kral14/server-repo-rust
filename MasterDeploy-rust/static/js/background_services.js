// Arxa Plan və Auto-Deploy İdarəetmə Mərkəzi
let currentBgSubTab = localStorage.getItem('active_bg_subtab') || 'autodeploy';
let autoDeployAppsList = [];
let autoDeployCurrentFilter = 'all';

// Canlı Tünel Avto-Sinxronizasiya (Real-Time Smart Polling)
let tunnelsAutoSyncTimer = null;
let lastTunnelsDataHash = '';
let pendingTunnelsMap = new Set();

function startTunnelAutoSync(isFast = false) {
    if (tunnelsAutoSyncTimer) {
        clearTimeout(tunnelsAutoSyncTimer);
        tunnelsAutoSyncTimer = null;
    }

    const activeTab = localStorage.getItem('active_tab') || 'dashboard';
    const bgSub = localStorage.getItem('active_bg_subtab') || currentBgSubTab || 'autodeploy';

    if (activeTab !== 'background-services' || bgSub !== 'tunnels') {
        return;
    }

    // Əgər keçidi gözlənilən layihə varsa hər 2 saniyədən bir, yoxdursa hər 6 saniyədən bir yoxlayırıq
    const delay = isFast ? 2000 : 6000;
    tunnelsAutoSyncTimer = setTimeout(async () => {
        if (!document.hidden) {
            await loadMultiNodeTunnelsOverview(true);
        } else {
            startTunnelAutoSync(isFast);
        }
    }, delay);
}

function stopTunnelAutoSync() {
    if (tunnelsAutoSyncTimer) {
        clearTimeout(tunnelsAutoSyncTimer);
        tunnelsAutoSyncTimer = null;
    }
}

function switchBgSubTab(tab) {
    if (!tab) {
        tab = localStorage.getItem('active_bg_subtab') || 'autodeploy';
    }
    currentBgSubTab = tab;
    try {
        localStorage.setItem('active_bg_subtab', tab);
    } catch (e) {}
    const tabs = ['autodeploy', 'watchdog', 'tunnels', 'logs'];
    tabs.forEach(t => {
        const btn = document.getElementById(`bg-subtab-btn-${t}`);
        const content = document.getElementById(`bg-content-${t}`);
        if (btn) {
            btn.classList.toggle('active', t === tab);
        }
        if (content) {
            content.style.display = (t === tab) ? 'block' : 'none';
        }
    });

    const primaryBtn = document.getElementById('btn-bg-action-primary');
    const primaryTxt = document.getElementById('txt-bg-action-primary');

    if (tab === 'autodeploy') {
        stopTunnelAutoSync();
        if (primaryBtn) {
            primaryBtn.style.display = 'flex';
            primaryBtn.innerHTML = '<i data-lucide="zap" style="width: 14px; height: 14px;"></i><span id="txt-bg-action-primary">Hamısını İndi Yoxla</span>';
        }
        loadAutoDeployCenter();
    } else if (tab === 'watchdog') {
        stopTunnelAutoSync();
        if (primaryBtn) {
            primaryBtn.style.display = 'flex';
            primaryBtn.innerHTML = '<i data-lucide="save" style="width: 14px; height: 14px;"></i><span id="txt-bg-action-primary">Ayarları Saxla</span>';
        }
        loadBackgroundServicesSettings();
        loadBackgroundAppsOverview();
    } else if (tab === 'tunnels') {
        if (primaryBtn) {
            primaryBtn.style.display = 'flex';
            primaryBtn.innerHTML = '<i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i><span id="txt-bg-action-primary">Tünelləri Yenilə</span>';
        }
        loadMultiNodeTunnelsOverview();
        startTunnelAutoSync(false);
    } else if (tab === 'logs') {
        stopTunnelAutoSync();
        if (primaryBtn) primaryBtn.style.display = 'none';
        loadBackgroundActivityLogs();
    }

    if (typeof updateHeaderSearchPlaceholder === 'function') {
        updateHeaderSearchPlaceholder('background-services');
    }
    const curSearchVal = document.getElementById('topbar-context-search')?.value;
    if (curSearchVal && typeof onHeaderContextSearch === 'function') {
        setTimeout(() => onHeaderContextSearch(curSearchVal), 150);
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

async function loadMultiNodeTunnelsOverview(isSilent = false) {
    const container = document.getElementById('bg-multi-node-tunnels-grid');
    if (!container) return;

    // Səhifənin hazırkı scroll vəziyyətini qeyd edirik ki, istifadəçi aşağı baxanda səhifə yuxarı atmasın
    const scrollParent = document.getElementById('tab-background-services') || document.querySelector('.tab-section.active');
    const savedScroll = scrollParent ? scrollParent.scrollTop : 0;

    // Yalnız ilk dəfə və içi tam boş olanda loading göstəririk
    const isAlreadyRendered = container.children.length > 0 && !container.querySelector('.no-data');
    if (!isSilent && !isAlreadyRendered) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                <div style="display: inline-block; animation: spin 1s linear infinite; margin-bottom: 0.5rem;">🔄</div>
                <div>Bütün VM-lər üzrə aktiv tünellər oxunur...</div>
            </div>
        `;
    }

    try {
        const [srvRes, tunRes] = await Promise.all([
            fetch('/api/servers'),
            fetch('/api/tunnels')
        ]);

        const servers = await srvRes.json();
        const tunnels = await tunRes.json();

        // Update KPI Card if present
        const kpiTunnels = document.getElementById('ad-stat-tunnels');
        if (kpiTunnels && Array.isArray(tunnels)) {
            const activeCount = tunnels.filter(t => t.status === 'active' || t.status === 'running').length;
            kpiTunnels.textContent = `${activeCount} Aktiv (${servers.length} VM)`;
        }

        if (!Array.isArray(servers) || servers.length === 0) {
            container.innerHTML = `<div class="no-data">Heç bir server tapılmadı.</div>`;
            return;
        }

        // Bütün marşrutları və statusları təhlil edirik (Keçidi gözlənilən layihələri tapırıq)
        let hasPendingRoutes = false;
        const currentPendingIds = new Set();
        const newlyReadyApps = [];
        const routesFlat = [];

        (Array.isArray(tunnels) ? tunnels : []).forEach(t => {
            (t.routes || []).forEach(r => {
                const link = r.cf_worker_url || r.cloudflare_url || '';
                routesFlat.push({
                    tId: t.id,
                    rId: r.route_id,
                    appId: r.app_id,
                    appName: r.app_name,
                    port: r.target_port,
                    link: link
                });
                if (!link) {
                    hasPendingRoutes = true;
                    currentPendingIds.add(r.app_id);
                } else if (pendingTunnelsMap.has(r.app_id)) {
                    // Əvvəlki dövrdə keçidi hazır deyildi, indi keçid linki gəldi!
                    newlyReadyApps.push(r.app_name || 'Layihə');
                }
            });
        });

        const newHash = JSON.stringify({
            servers: (servers || []).map(s => `${s.id}_${s.name}_${s.ip}`),
            tunnels: (tunnels || []).map(t => `${t.id}_${t.status}_${t.public_url}`),
            routes: routesFlat
        });

        // Əgər dəyişiklik yoxdursa və səssiz polling rejimindəyiksə, DOM-a toxunmuruq (titrəmənin qarşısını alırıq)
        if (isSilent && newHash === lastTunnelsDataHash) {
            startTunnelAutoSync(hasPendingRoutes);
            return;
        }

        lastTunnelsDataHash = newHash;
        pendingTunnelsMap = currentPendingIds;

        // Əgər yenicə linki hazır olan layihə varsa, istifadəçiyə canlı bildiriş veririk
        if (newlyReadyApps.length > 0) {
            newlyReadyApps.forEach(name => {
                showToast(`🚀 "${name}" üçün keçid linki hazır oldu və aktivləşdirildi!`, 'success');
            });
            if (typeof loadApplications === 'function') loadApplications();
        }

        container.innerHTML = servers.map(srv => {
            const srvTunnels = (Array.isArray(tunnels) ? tunnels : []).filter(t => t.server_id === srv.id);
            const hasTunnels = srvTunnels.length > 0;
            const srvNameLower = (srv.name || '').toLowerCase();
            const srvIpLower = (srv.ip || '').toLowerCase();

            return `
            <div class="card tunnel-vm-card" data-vm-name="${srvNameLower}" data-vm-ip="${srvIpLower}" style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 9px; padding: 0.65rem 0.9rem; margin-bottom: 0.65rem; border-left: 3px solid ${hasTunnels ? '#00d2ff' : '#64748b'};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 6px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2);">
                            <i data-lucide="server" style="width: 15px; height: 15px; color: #38bdf8;"></i>
                        </span>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <h3 style="margin: 0; font-size: 0.92rem; color: #fff; font-weight: 600;">
                                ${srv.name}
                                <span style="font-size: 0.72rem; color: var(--text-secondary); font-family: monospace; font-weight: normal; margin-left: 4px;">(${srv.ip})</span>
                            </h3>
                            <span style="font-size: 0.7rem; color: #38bdf8; background: rgba(0, 210, 255, 0.08); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(0, 210, 255, 0.2);">
                                ${srvTunnels.length} tünel
                            </span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <button class="btn btn-primary btn-xs" onclick="openCreateTunnelModal('${srv.id}', '${srv.name} (${srv.ip})')" style="font-size: 0.72rem; padding: 3px 9px; background: linear-gradient(135deg, #7c3aed, #00d2ff); border: none; font-weight: 600; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;">
                            <i data-lucide="plus" style="width: 11px; height: 11px;"></i>
                            <span>Yeni Tünel</span>
                        </button>
                        <button class="btn btn-secondary btn-xs" onclick="installPluginToServer('cloudflare', '${srv.id}')" style="font-size: 0.72rem; padding: 3px 8px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;" title="Cloudflare Daemon-u yoxla və bərpa et">
                            <i data-lucide="settings" style="width: 11px; height: 11px; color: #94a3b8;"></i>
                            <span>Daemon</span>
                        </button>
                    </div>
                </div>

                <!-- Tünellərin Siyahısı -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    ${hasTunnels ? srvTunnels.map(t => {
                        const isShared = t.tunnel_type === 'shared';
                        const isRunning = t.status === 'active' || t.status === 'running';
                        const liveUrl = t.public_url || '';
                        const routes = Array.isArray(t.routes) ? t.routes : [];
                        const tNameLower = (t.name || '').toLowerCase();

                        return `
                        <div class="tunnel-card-item" data-tunnel-name="${tNameLower}" style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 7px 10px; display: flex; flex-direction: column; gap: 5px;">
                            <!-- Tünel Başlıq Sətri -->
                            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isRunning ? '#4ade80' : '#f59e0b'}; box-shadow: 0 0 6px ${isRunning ? '#4ade80' : '#f59e0b'};"></span>
                                    <strong style="font-size: 0.86rem; color: #fff;">${t.name}</strong>
                                    <span style="font-size: 0.66rem; padding: 1px 5px; border-radius: 3px; background: ${isShared ? 'rgba(56, 189, 248, 0.12)' : 'rgba(168, 85, 247, 0.12)'}; color: ${isShared ? '#38bdf8' : '#c084fc'}; border: 1px solid ${isShared ? 'rgba(56, 189, 248, 0.25)' : 'rgba(168, 85, 247, 0.25)'};">
                                        ${isShared ? 'Ortaq' : 'Ayrı'}
                                    </span>
                                    ${liveUrl ? `
                                        <a href="${liveUrl}" target="_blank" style="color: #38bdf8; font-size: 0.72rem; font-family: monospace; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; background: rgba(0,210,255,0.06); padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(0,210,255,0.15);" title="Əsas Tünel Linki">
                                            <i data-lucide="external-link" style="width: 11px; height: 11px; color: #00d2ff; flex-shrink: 0;"></i>
                                            <span>${liveUrl}</span>
                                        </a>
                                        <button class="btn btn-secondary btn-xs" onclick="navigator.clipboard.writeText('${liveUrl}'); showToast('Tünel linki kopyalandı!', 'info');" style="padding: 2px 6px; font-size: 0.65rem; display: inline-flex; align-items: center;" title="Kopyala">
                                            <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                                        </button>
                                    ` : `
                                        <span style="color: #eab308; font-size: 0.7rem; display: inline-flex; align-items: center; gap: 5px;">
                                            <span style="width: 6px; height: 6px; border-radius: 50%; background: #eab308; display: inline-block;"></span>
                                            <span>Gözlənilir...</span>
                                        </span>
                                    `}
                                </div>

                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <button class="btn btn-secondary btn-xs" onclick="openAttachRouteModal('${t.id}', '${t.name}', '${srv.id}')" style="font-size: 0.7rem; padding: 2px 7px; color: #38bdf8; border-color: rgba(56, 189, 248, 0.25); display: inline-flex; align-items: center; gap: 3px;">
                                        <i data-lucide="plus" style="width: 11px; height: 11px;"></i>
                                        <span>Layihə Qoş</span>
                                    </button>
                                    <button class="btn btn-secondary btn-xs" onclick="syncTunnelRemote('${t.id}')" style="font-size: 0.7rem; padding: 2px 7px; display: inline-flex; align-items: center; gap: 3px;" title="Tüneli yenidən sinxronlaşdır">
                                        <i data-lucide="refresh-cw" style="width: 11px; height: 11px;"></i>
                                        <span>Sinxron</span>
                                    </button>
                                    <button class="btn btn-secondary btn-xs" onclick="deleteTunnelDirect('${t.id}')" style="font-size: 0.7rem; padding: 2px 6px; color: #ff5555 !important; border-color: rgba(255, 85, 85, 0.25); display: inline-flex; align-items: center;" title="Tüneli Sil">
                                        <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
                                    </button>
                                </div>
                            </div>

                            <!-- Bağlı Layihələr (Yığcam Siyahı) -->
                            <div style="padding-top: 2px;">
                                ${routes.length > 0 ? `
                                    <div class="tunnel-routes-list" style="display: flex; flex-direction: column; gap: 3px; max-height: 260px; overflow-y: auto; padding-right: 2px;">
                                        ${routes.map(r => {
                                            const appLink = r.cf_worker_url || r.cloudflare_url || '';
                                            const searchKey = `${(r.app_name || '').toLowerCase()} ${r.target_port} ${appLink.toLowerCase()} ${tNameLower} ${srvNameLower} ${srvIpLower}`;

                                            return `
                                            <div class="tunnel-app-row" data-search-key="${searchKey}" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 5px; padding: 3px 8px; font-size: 0.76rem;">
                                                <!-- Sol: Layihə Adı və Port -->
                                                <div style="display: flex; align-items: center; gap: 6px; min-width: 150px; flex-shrink: 0;">
                                                    <i data-lucide="box" style="width: 13px; height: 13px; color: #38bdf8; flex-shrink: 0;"></i>
                                                    <strong style="color: #f1f5f9; font-size: 0.79rem;">${r.app_name}</strong>
                                                    <span style="color: #38bdf8; font-size: 0.7rem; font-family: monospace; background: rgba(56, 189, 248, 0.1); padding: 0 4px; border-radius: 3px;">:${r.target_port}</span>
                                                </div>

                                                <!-- Orta: Fərdi Keçid Linki -->
                                                <div style="display: flex; align-items: center; gap: 5px; flex: 1; min-width: 180px;">
                                                    ${appLink ? `
                                                        <div style="display: flex; align-items: center; gap: 5px; background: rgba(0,0,0,0.3); border: 1px solid rgba(0,210,255,0.15); border-radius: 4px; padding: 1px 6px; width: 100%; max-width: 440px;">
                                                            <span style="color: #00d2ff; font-size: 0.65rem; font-weight: 700; flex-shrink: 0;">${r.cf_worker_url ? 'WORKER' : 'KEÇİD'}:</span>
                                                            <a href="${appLink}" target="_blank" style="color: #38bdf8; font-size: 0.72rem; font-family: monospace; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${appLink}">
                                                                ${appLink}
                                                            </a>
                                                            <button class="btn btn-secondary btn-xs" onclick="navigator.clipboard.writeText('${appLink}'); showToast('Layihə linki kopyalandı!', 'info');" style="padding: 1px 5px; font-size: 0.65rem; border-radius: 3px; flex-shrink: 0; display: inline-flex; align-items: center;" title="Linki kopyala">
                                                                <i data-lucide="copy" style="width: 10px; height: 10px;"></i>
                                                            </button>
                                                        </div>
                                                    ` : `
                                                        <span style="color: #eab308; font-size: 0.7rem; display: inline-flex; align-items: center; gap: 5px; font-style: italic; background: rgba(234, 179, 8, 0.08); padding: 2px 7px; border-radius: 4px; border: 1px solid rgba(234, 179, 8, 0.2);">
                                                            <i data-lucide="loader-2" style="width: 11px; height: 11px; animation: spin 1.5s linear infinite;"></i>
                                                            <span>Keçid hazırlanır (canlı izlənilir)...</span>
                                                        </span>
                                                    `}
                                                </div>

                                                <!-- Sağ: Düymələr (Tarixçə, Loq, Dayandır, Ayır) -->
                                                <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                                                    <button class="btn btn-secondary btn-xs" onclick="openTunnelLinkHistoryModal('${r.app_id}', '${r.app_name}')" style="padding: 2px 7px; font-size: 0.68rem; border-radius: 4px; color: #38bdf8; border-color: rgba(56,189,248,0.25); background: rgba(56,189,248,0.06); display: inline-flex; align-items: center; gap: 3px;" title="Link Tarixçəsi və Vaxtlar">
                                                        <i data-lucide="clock" style="width: 11px; height: 11px;"></i>
                                                        <span>Tarixçə</span>
                                                    </button>
                                                    <button class="btn btn-secondary btn-xs" onclick="generateCloudflareTunnel(event, '${r.app_id}', '${r.app_name}')" style="padding: 2px 7px; font-size: 0.68rem; border-radius: 4px; color: #f97316; border-color: rgba(249,115,22,0.25); background: rgba(249,115,22,0.06); display: inline-flex; align-items: center; gap: 3px;" title="Terminal və Canlı Loqlar">
                                                        <i data-lucide="terminal" style="width: 11px; height: 11px;"></i>
                                                        <span>Loq</span>
                                                    </button>
                                                    <button class="btn btn-secondary btn-xs" onclick="stopTunnelForRoute('${r.app_id}', '${r.app_name}')" style="padding: 2px 7px; font-size: 0.68rem; border-radius: 4px; color: #ef4444; border-color: rgba(239,68,68,0.25); background: rgba(239,68,68,0.06); display: inline-flex; align-items: center; gap: 3px;" title="Bu layihənin tünel prosesini dayandır">
                                                        <i data-lucide="square" style="width: 10px; height: 10px;"></i>
                                                        <span>Dayandır</span>
                                                    </button>
                                                    <button class="btn btn-secondary btn-xs" onclick="detachTunnelRouteDirect('${t.id}', '${r.route_id}', '${r.app_name}')" style="color: #94a3b8 !important; border-color: rgba(255,255,255,0.12); font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Layihəni tüneldən ayır">
                                                        <i data-lucide="unlink" style="width: 10px; height: 10px;"></i>
                                                        <span>Ayır</span>
                                                    </button>
                                                </div>
                                            </div>
                                            `;
                                        }).join('')}
                                    </div>
                                ` : `
                                    <div style="color: #64748b; font-size: 0.72rem; padding: 2px 4px; font-style: italic;">Heç bir layihə bağlanmayıb. "+ Layihə Qoş" ilə əlavə edin.</div>
                                `}
                            </div>
                        </div>
                        `;
                    }).join('') : `
                        <div style="padding: 10px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 6px; text-align: center; color: var(--text-secondary); font-size: 0.78rem;">
                            Bu server üçün tünel qeydiyyatda deyil.
                            <button class="btn btn-primary btn-xs" onclick="openCreateTunnelModal('${srv.id}', '${srv.name} (${srv.ip})')" style="margin-left: 8px; font-size: 0.72rem; padding: 2px 8px; background: linear-gradient(135deg, #7c3aed, #00d2ff); border: none; display: inline-flex; align-items: center; gap: 4px;">
                                <i data-lucide="plus" style="width: 11px; height: 11px;"></i>
                                <span>İlk Tüneli Yarat</span>
                            </button>
                        </div>
                    `}
                </div>
            </div>
            `;
        }).join('');

        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }

        // Əgər istifadəçi səhifəni aşağı çəkibsə, həmin mövqeyi dərhal bərpa edirik (yuxarı atmanın qarşısını alırıq)
        if (scrollParent && savedScroll > 0) {
            scrollParent.scrollTop = savedScroll;
            requestAnimationFrame(() => {
                if (scrollParent) scrollParent.scrollTop = savedScroll;
            });
        }

        // Əgər axtarış sahəsində filtr varsa, yenidən tətbiq edirik
        const curSearchVal = document.getElementById('topbar-context-search')?.value;
        if (curSearchVal && typeof onHeaderContextSearch === 'function') {
            onHeaderContextSearch(curSearchVal);
        }

        // Növbəti avtomatik yoxlamanı planlaşdırırıq (Keçid gözlənilirsə hər 2 saniyə, yoxdursa hər 6 saniyə)
        startTunnelAutoSync(hasPendingRoutes);

    } catch (e) {
        container.innerHTML = `<div style="color: #ff5252; padding: 1rem;">Tünellər oxunarkən xəta: ${e.message}</div>`;
        startTunnelAutoSync(false);
    }
}

async function openCreateTunnelModal(serverId, serverDisplay) {
    if (typeof ensureModalsLoaded === 'function') {
        await ensureModalsLoaded();
    }
    if (typeof showModal === 'function') {
        await showModal('create-tunnel-modal');
    }

    const srvIdInput = document.getElementById('tun-server-id');
    const srvDispInput = document.getElementById('tun-server-display');
    const nameInput = document.getElementById('tun-name');
    const typeInput = document.getElementById('tun-type');

    if (srvIdInput) srvIdInput.value = serverId;
    if (srvDispInput) srvDispInput.value = serverDisplay || serverId;
    if (nameInput) nameInput.value = 'Tunel-B';
    if (typeInput) typeInput.value = 'shared';
}

async function handleCreateTunnelSubmit(e) {
    e.preventDefault();
    const serverId = document.getElementById('tun-server-id').value;
    const name = document.getElementById('tun-name').value.trim();
    const tunnelType = document.getElementById('tun-type').value;

    if (!name) {
        showToast('Tünel adı daxil edilməlidir', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/tunnels/server/${serverId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ server_id: serverId, name, tunnel_type: tunnelType })
        });
        if (res.ok) {
            showToast(`'${name}' tüneli uğurla yaradıldı! 🎉`, 'success');
            if (typeof closeModal === 'function') closeModal('create-tunnel-modal');
            loadMultiNodeTunnelsOverview();
        } else {
            const err = await res.text();
            showToast('Xəta: ' + err, 'error');
        }
    } catch (err) {
        showToast('Şəbəkə xətası: ' + err.message, 'error');
    }
}

async function openAttachRouteModal(tunnelId, tunnelName, serverId) {
    if (typeof ensureModalsLoaded === 'function') {
        await ensureModalsLoaded();
    }
    if (typeof showModal === 'function') {
        await showModal('attach-route-modal');
    }

    const tunIdInput = document.getElementById('attach-tunnel-id');
    const srvIdInput = document.getElementById('attach-server-id');
    const tunNameInput = document.getElementById('attach-tunnel-name');
    const select = document.getElementById('attach-app-select');

    if (tunIdInput) tunIdInput.value = tunnelId;
    if (srvIdInput) srvIdInput.value = serverId;
    if (tunNameInput) tunNameInput.value = tunnelName;
    if (select) select.innerHTML = '<option value="">⏳ Layihələr oxunur...</option>';

    try {
        const res = await fetch('/api/applications');
        const allApps = await res.json();
        const serverApps = (Array.isArray(allApps) ? allApps : []).filter(a => a.server_id === serverId);

        const curSelect = document.getElementById('attach-app-select');
        if (!curSelect) return;

        if (serverApps.length === 0) {
            curSelect.innerHTML = '<option value="">Bu serverdə heç bir layihə tapılmadı</option>';
            return;
        }

        curSelect.innerHTML = serverApps.map(a => `
            <option value="${a.id}" data-port="${a.port || 8080}">${a.name} (Daxili Port: ${a.port || 8080})</option>
        `).join('');

        if (serverApps[0]) {
            const portInput = document.getElementById('attach-target-port');
            if (portInput) portInput.value = serverApps[0].port || 8080;
        }
    } catch (e) {
        const curSelect = document.getElementById('attach-app-select');
        if (curSelect) curSelect.innerHTML = `<option value="">Xəta: ${e.message}</option>`;
    }
}

function updateAttachTargetPort(selectEl) {
    const opt = selectEl.options[selectEl.selectedIndex];
    if (opt && opt.dataset.port) {
        const portInput = document.getElementById('attach-target-port');
        if (portInput) portInput.value = opt.dataset.port;
    }
}

async function handleAttachRouteSubmit(e) {
    e.preventDefault();
    const tunnelId = document.getElementById('attach-tunnel-id').value;
    const appId = document.getElementById('attach-app-select').value;
    const targetPort = parseInt(document.getElementById('attach-target-port').value, 10) || 8080;

    if (!appId) {
        showToast('Layihə seçilməlidir', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/tunnels/${tunnelId}/attach`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tunnel_id: tunnelId, app_id: appId, target_port: targetPort, route_path: '/' })
        });
        if (res.ok) {
            showToast('Layihə tünelə qoşuldu və serverdə tünel işə salınır... ⚡', 'info');
            if (typeof closeModal === 'function') closeModal('attach-route-modal');
            loadMultiNodeTunnelsOverview(true);
            startTunnelAutoSync(true);
            if (typeof loadApplications === 'function') loadApplications();
        } else {
            const err = await res.text();
            showToast('Xəta: ' + err, 'error');
        }
    } catch (err) {
        showToast('Şəbəkə xətası: ' + err.message, 'error');
    }
}

async function stopTunnelForRoute(appId, appName) {
    const displayName = appName ? `'${appName}'` : 'Bu';
    const confirmed = await showConfirmModal({
        title: 'Tüneli Dayandır',
        subtitle: displayName,
        message: `${displayName} layihəsinin tünel bağlantısını dayandırmaq istədiyinizə əminsiniz?`,
        warning: 'Dayandırıldıqda layihənin xarici Cloudflare keçidi müvəqqəti bağlanacaq.',
        confirmText: 'Dayandır',
        type: 'warning',
        icon: '🛑'
    });
    if (!confirmed) return;
    try {
        const res = await fetch(`/api/plugins/cloudflare/stop/${appId}`, { method: 'POST' });
        if (res.ok) {
            showToast('Tünel dayandırıldı və link çıxarıldı.', 'warning');
            loadMultiNodeTunnelsOverview();
            if (typeof loadApplications === 'function') loadApplications();
        } else {
            const err = await res.text();
            showToast('Xəta: ' + err, 'error');
        }
    } catch (e) {
        showToast('Xəta: ' + e.message, 'error');
    }
}

async function detachTunnelRouteDirect(tunnelId, routeId, appName) {
    const displayName = appName ? `'${appName}'` : 'Bu layihəni';
    const confirmed = await showConfirmModal({
        title: 'Tüneldən Ayır',
        subtitle: displayName,
        message: `${displayName} layihəsini tüneldən ayırmaq istədiyinizə əminsiniz?`,
        warning: 'Layihənin tünel bağlantısı və xarici keçidi də sistemdən tam çıxarılacaq.',
        confirmText: 'Tüneldən Ayır',
        type: 'danger',
        icon: '🔗'
    });
    if (!confirmed) return;
    try {
        const res = await fetch(`/api/tunnels/${tunnelId}/routes/${routeId}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Layihə tüneldən ayrıldı və keçidi təmizləndi! 🔗', 'success');
            loadMultiNodeTunnelsOverview();
            if (typeof loadApplications === 'function') loadApplications();
        } else {
            const err = await res.text();
            showToast('Xəta: ' + err, 'error');
        }
    } catch (e) {
        showToast('Xəta: ' + e.message, 'error');
    }
}

async function syncTunnelRemote(tunnelId) {
    try {
        const res = await fetch(`/api/tunnels/${tunnelId}/sync-remote`, { method: 'POST' });
        if (res.ok) {
            showToast('Tünel konfiqurasiyası VM ilə sinxronlaşdırıldı! ⚡', 'success');
            loadMultiNodeTunnelsOverview();
            if (typeof loadApplications === 'function') loadApplications();
        }
    } catch (e) {
        showToast('Sinxronizasiya xətası: ' + e.message, 'error');
    }
}

async function deleteTunnelDirect(tunnelId) {
    const confirmed = await showConfirmModal({
        title: 'Tüneli Sil',
        message: 'Bu tüneli tamamilə silmək istədiyinizə əminsiniz?',
        warning: 'Bu tünelə bağlı bütün layihələrin xarici bağlantısı dayandırılacaq.',
        confirmText: 'Tüneli Sil',
        type: 'danger',
        icon: '🗑️'
    });
    if (!confirmed) return;
    try {
        const res = await fetch(`/api/tunnels/${tunnelId}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Tünel silindi!', 'success');
            loadMultiNodeTunnelsOverview();
            if (typeof loadApplications === 'function') loadApplications();
        }
    } catch (e) {
        showToast('Silinmə xətası: ' + e.message, 'error');
    }
}


async function loadAutoDeployCenter(isSilent = false) {
    const container = document.getElementById('autodeploy-cards-container');
    if (!container) return;

    const scrollParent = document.getElementById('tab-background-services') || document.querySelector('.tab-section.active');
    const savedScroll = scrollParent ? scrollParent.scrollTop : 0;

    const isAlreadyRendered = container.children.length > 0;
    if (!isSilent && !isAlreadyRendered) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2.5rem; color: var(--text-secondary);">
                <div style="display: inline-block; animation: spin 1s linear infinite; margin-bottom: 0.5rem;">🔄</div>
                <div>Bütün layihələrin və arxa plan servislərinin statusları oxunur...</div>
            </div>
        `;
    }

    try {
        const res = await fetch('/api/applications/autodeploy-list');
        if (!res.ok) throw new Error('Məlumatları almaq mümkün olmadı');
        autoDeployAppsList = await res.json();
        renderAutoDeployCenter();

        if (scrollParent && savedScroll > 0) {
            scrollParent.scrollTop = savedScroll;
            requestAnimationFrame(() => {
                if (scrollParent) scrollParent.scrollTop = savedScroll;
            });
        }

        fetch('/api/tunnels')
            .then(r => r.json())
            .then(tuns => {
                const kpiTunnels = document.getElementById('ad-stat-tunnels');
                if (kpiTunnels && Array.isArray(tuns)) {
                    const activeCount = tuns.filter(t => t.status === 'active' || t.status === 'running').length;
                    kpiTunnels.textContent = `${activeCount} Aktiv`;
                }
            })
            .catch(() => {});
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
            typeBadge = `<span style="font-size:0.65rem; padding: 1px 6px; border-radius: 4px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 600; border: 1px solid rgba(245, 158, 11, 0.25); display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="shield" style="width: 10px; height: 10px;"></i> Sistem Servisi</span>`;
        } else if (isImage) {
            typeBadge = `<span style="font-size:0.65rem; padding: 1px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; border: 1px solid rgba(56, 189, 248, 0.25); display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="container" style="width: 10px; height: 10px;"></i> Docker Image</span>`;
        } else {
            typeBadge = `<span style="font-size:0.65rem; padding: 1px 6px; border-radius: 4px; background: rgba(168, 85, 247, 0.15); color: #c084fc; font-weight: 600; border: 1px solid rgba(168, 85, 247, 0.25); display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="git-branch" style="width: 10px; height: 10px;"></i> Git Repo (${app.branch || 'main'})</span>`;
        }

        const roleBadge = isSystemService 
            ? `<span style="font-size:0.65rem; padding: 1px 6px; border-radius: 4px; background: rgba(234, 179, 8, 0.15); color: #facc15; font-weight: 600; border: 1px solid rgba(234, 179, 8, 0.25); display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="cpu" style="width: 10px; height: 10px;"></i> Arxa Plan Modulu</span>`
            : `<span style="font-size:0.65rem; padding: 1px 6px; border-radius: 4px; background: rgba(52, 211, 153, 0.12); color: #34d399; font-weight: 600; border: 1px solid rgba(52, 211, 153, 0.25); display: inline-flex; align-items: center; gap: 3px;"><i data-lucide="sparkles" style="width: 10px; height: 10px;"></i> Tətbiq</span>`;

        const sourceAddress = isSystemService
            ? (app.registry_image || app.repo_url || 'Sistem nüvə xidməti')
            : (isImage ? (app.registry_image || 'Təyin edilməyib') : (app.repo_url || 'Repo linki yoxdur'));

        let mainIcon = '<i data-lucide="rocket" style="width: 15px; height: 15px; color: #f43f5e;"></i>';
        if (isSystemService) {
            mainIcon = app.id.includes('tunnel') 
                ? '<i data-lucide="cloud" style="width: 15px; height: 15px; color: #f59e0b;"></i>' 
                : '<i data-lucide="trash-2" style="width: 15px; height: 15px; color: #34d399;"></i>';
        } else if (isImage) {
            mainIcon = '<i data-lucide="container" style="width: 15px; height: 15px; color: #38bdf8;"></i>';
        }

        return `
            <div class="item-card" style="background: rgba(15, 23, 42, 0.55); border: 1px solid ${isEnabled ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.06)'}; border-left: 2px solid ${isEnabled ? (isSystemService ? '#f59e0b' : '#38bdf8') : '#64748b'}; border-radius: 8px; padding: 0.42rem 0.85rem; transition: all 0.2s;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.6rem;">
                    
                    <!-- Sol: İdentifikasiya (Kompakt və Zərif) -->
                    <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 280px; flex: 1;">
                        <div style="width: 28px; height: 28px; border-radius: 6px; background: ${isEnabled ? (isSystemService ? 'rgba(245, 158, 11, 0.12)' : 'rgba(56, 189, 248, 0.12)') : 'rgba(255, 255, 255, 0.05)'}; display: flex; align-items: center; justify-content: center; color: ${isEnabled ? '#38bdf8' : '#94a3b8'}; flex-shrink: 0;">
                            ${mainIcon}
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1;">
                            <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;">
                                <div style="width: 165px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${app.name}">
                                    <strong style="font-size: 0.88rem; color: #fff;">${app.name}</strong>
                                </div>
                                <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
                                    ${roleBadge}
                                    ${typeBadge}
                                </div>
                            </div>
                            <div style="font-size: 0.72rem; color: var(--text-secondary); font-family: monospace; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${sourceAddress}">
                                ${sourceAddress}
                            </div>
                            <div style="font-size: 0.68rem; color: #94a3b8; display: flex; align-items: center; gap: 0.35rem;">
                                <i data-lucide="clock" style="width: 11px; height: 11px; color: #64748b;"></i>
                                <span>Son Yoxlanış: <strong style="color: #cbd5e1;">${lastCheck}</strong></span>
                            </div>
                        </div>
                    </div>

                    <!-- Orta: Sazlamalar (İnterval və Limit - Kompakt Sütunlar) -->
                    <div style="display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; opacity: ${isEnabled ? '1' : '0.45'}; pointer-events: ${isEnabled ? 'auto' : 'none'};">
                        <div style="width: 115px; flex-shrink: 0; display: flex; flex-direction: column; gap: 0.15rem;">
                            <label style="font-size: 0.62rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">
                                İnterval ${isEnabled ? '' : '<span style="color: #ef4444;">(Sönülüdür)</span>'}
                            </label>
                            <select ${isEnabled ? '' : 'disabled'} onchange="updateAppAutoDeployQuick('${app.id}', this.value, null, null)" style="width: 100%; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); border-radius: 5px; padding: 0.22rem 0.45rem; color: #fff; font-size: 0.72rem; height: 26px;">
                                <option value="5" ${interval == 5 ? 'selected' : ''}>Hər 5 dəqiqə</option>
                                <option value="15" ${interval == 15 ? 'selected' : ''}>Hər 15 dəqiqə</option>
                                <option value="30" ${interval == 30 ? 'selected' : ''}>Hər 30 dəqiqə</option>
                                <option value="60" ${interval == 60 ? 'selected' : ''}>Hər 1 saat</option>
                                <option value="360" ${interval == 360 ? 'selected' : ''}>Hər 6 saat</option>
                                <option value="1440" ${interval == 1440 ? 'selected' : ''}>Hər 24 saat</option>
                            </select>
                        </div>

                        <div style="width: 80px; flex-shrink: 0; display: flex; flex-direction: column; gap: 0.15rem;">
                            <label style="font-size: 0.62rem; color: var(--text-secondary); font-weight: 600; text-transform: uppercase;">Limit</label>
                            <select ${isEnabled ? '' : 'disabled'} onchange="updateAppAutoDeployQuick('${app.id}', null, this.value, null)" style="width: 100%; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); border-radius: 5px; padding: 0.22rem 0.45rem; color: #fff; font-size: 0.72rem; height: 26px;">
                                <option value="5" ${timeout == 5 ? 'selected' : ''}>5 saniyə</option>
                                <option value="10" ${timeout == 10 ? 'selected' : ''}>10 saniyə</option>
                                <option value="15" ${timeout == 15 ? 'selected' : ''}>15 saniyə</option>
                                <option value="30" ${timeout == 30 ? 'selected' : ''}>30 saniyə</option>
                                <option value="60" ${timeout == 60 ? 'selected' : ''}>60 saniyə</option>
                            </select>
                        </div>
                    </div>

                    <!-- Sağ: ON/OFF Toggle və İndi Yoxla (Kompakt Düymələr) -->
                    <div style="display: flex; align-items: center; gap: 0.8rem;">
                        <div style="width: 65px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 0.15rem;">
                            <label class="md-switch" title="Auto-Deploy aktivləşdir və ya söndür" style="transform: scale(0.85); margin: 0;">
                                <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="updateAppAutoDeployQuick('${app.id}', null, null, this.checked ? 1 : 0)">
                                <span class="md-switch-slider"></span>
                            </label>
                            <span style="font-size: 0.62rem; font-weight: 600; color: ${isEnabled ? '#38bdf8' : '#64748b'};">
                                ${isEnabled ? 'Aktiv 🟢' : 'Sönülü ⚪'}
                            </span>
                        </div>

                        <div style="width: 95px; flex-shrink: 0; display: flex; justify-content: flex-end;">
                            <button class="hbtn hbtn-check" onclick="triggerManualDeployCheck('${app.id}', this)" title="Dərhal yoxla" style="padding: 0.28rem 0.6rem; font-size: 0.74rem; width: 100%; height: 28px; justify-content: center;">
                                <i data-lucide="scan" style="width: 12px; height: 12px;"></i>
                                <span>İndi Yoxla</span>
                            </button>
                        </div>
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

let cleanModalCurrentStats = null;

// Server Dərindən Təmizləmə Modalı Açılması
async function openServerCleanModal() {
    await showModal('server-clean-modal');

    // Hədd gününü sinxronlaşdırırıq
    const daysInput = document.getElementById('bg-input-autoclean-days');
    const labelDays = document.getElementById('clean-db-days-label');
    if (daysInput && labelDays) {
        labelDays.textContent = daysInput.value || '30';
    }

    // Terminal və nəticə hissəsini ilkin vəziyyətə gətiririk
    const term = document.getElementById('clean-terminal-console');
    const termStatus = document.getElementById('clean-terminal-status');
    const diffResult = document.getElementById('clean-diff-result');
    if (term) term.textContent = '[Sistem] Təmizləməyə hazırdır. Serveri seçib "Təmizləməyə Başla" düyməsini sıxın.';
    if (termStatus) {
        termStatus.textContent = 'Gözlənilir';
        termStatus.style.color = '#64748b';
    }
    if (diffResult) diffResult.style.display = 'none';
    const ramFreedBarInit = document.getElementById('clean-stat-ram-freed-bar');
    const ramLegendInit = document.getElementById('clean-stat-ram-legend');
    const diskFreedBarInit = document.getElementById('clean-stat-disk-freed-bar');
    const diskLegendInit = document.getElementById('clean-stat-disk-legend');
    if (ramFreedBarInit) ramFreedBarInit.style.display = 'none';
    if (ramLegendInit) ramLegendInit.style.display = 'none';
    if (diskFreedBarInit) diskFreedBarInit.style.display = 'none';
    if (diskLegendInit) diskLegendInit.style.display = 'none';

    // Serverləri yükləyirik
    const select = document.getElementById('clean-modal-server-select');
    if (!select) return;

    select.innerHTML = '<option value="">Serverlər yüklənir...</option>';

    try {
        const res = await fetch('/api/servers');
        if (!res.ok) throw new Error('Serverləri almaq mümkün olmadı');
        const servers = await res.json();
        
        if (!Array.isArray(servers) || servers.length === 0) {
            select.innerHTML = '<option value="">Heç bir server tapılmadı</option>';
            return;
        }

        select.innerHTML = servers.map(s => `
            <option value="${s.id}">${s.name} (${s.ip})</option>
        `).join('');

        // İlk serverin göstəricilərini oxuyuruq
        await refreshCleanModalStats();
    } catch (e) {
        select.innerHTML = `<option value="">Xəta: ${e.message}</option>`;
    }
}

async function handleCleanModalServerChange() {
    const diffResult = document.getElementById('clean-diff-result');
    if (diffResult) diffResult.style.display = 'none';
    const ramFreedBar = document.getElementById('clean-stat-ram-freed-bar');
    const ramLegend = document.getElementById('clean-stat-ram-legend');
    const diskFreedBar = document.getElementById('clean-stat-disk-freed-bar');
    const diskLegend = document.getElementById('clean-stat-disk-legend');
    if (ramFreedBar) ramFreedBar.style.display = 'none';
    if (ramLegend) ramLegend.style.display = 'none';
    if (diskFreedBar) diskFreedBar.style.display = 'none';
    if (diskLegend) diskLegend.style.display = 'none';
    await refreshCleanModalStats();
}

async function refreshCleanModalStats(beforeStats = null) {
    const select = document.getElementById('clean-modal-server-select');
    if (!select || !select.value) return;

    const serverId = select.value;
    const ramText = document.getElementById('clean-stat-ram-text');
    const ramBar = document.getElementById('clean-stat-ram-bar');
    const ramFreedBar = document.getElementById('clean-stat-ram-freed-bar');
    const ramLegend = document.getElementById('clean-stat-ram-legend');

    const diskText = document.getElementById('clean-stat-disk-text');
    const diskBar = document.getElementById('clean-stat-disk-bar');
    const diskFreedBar = document.getElementById('clean-stat-disk-freed-bar');
    const diskLegend = document.getElementById('clean-stat-disk-legend');

    if (ramText) ramText.textContent = 'Yoxlanılır...';
    if (diskText) diskText.textContent = 'Yoxlanılır...';

    try {
        const res = await fetch(`/api/servers/${serverId}/stats`);
        if (!res.ok) throw new Error('Metriklər oxunmadı');
        const stats = await res.json();
        cleanModalCurrentStats = stats;

        // RAM UI
        const usedRam = stats.used_ram_mb || 0;
        const totalRam = stats.total_ram_mb || 0;
        const ramPct = stats.ram_percent || (totalRam > 0 ? Math.round((usedRam / totalRam) * 100) : 0);
        if (ramText) ramText.textContent = `${usedRam} / ${totalRam} MB (${ramPct}%)`;
        if (ramBar) {
            ramBar.style.width = `${Math.min(ramPct, 100)}%`;
            ramBar.style.background = ramPct > 85 ? 'linear-gradient(90deg, #ef4444, #dc2626)' : 'linear-gradient(90deg, #38bdf8, #818cf8)';
        }

        // RAM Təmizlənən Pay (Zolaq)
        if (beforeStats && (beforeStats.used_ram_mb || 0) > usedRam) {
            const oldRamPct = beforeStats.ram_percent || (totalRam > 0 ? Math.round(((beforeStats.used_ram_mb || 0) / totalRam) * 100) : 0);
            const freedRamPct = Math.max(0, oldRamPct - ramPct);
            if (ramFreedBar && freedRamPct > 0) {
                ramFreedBar.style.display = 'block';
                ramFreedBar.style.left = `${ramPct}%`;
                ramFreedBar.style.width = `${freedRamPct}%`;
            }
            if (ramLegend) {
                const freedMb = (beforeStats.used_ram_mb || 0) - usedRam;
                ramLegend.style.display = 'block';
                ramLegend.innerHTML = `✨ <strong>RAM Boşaldı:</strong> +${freedMb} MB (${oldRamPct}% ➔ ${ramPct}%)`;
            }
        } else if (!beforeStats) {
            if (ramFreedBar) ramFreedBar.style.display = 'none';
            if (ramLegend) ramLegend.style.display = 'none';
        }

        // Disk UI
        const diskUsed = stats.disk_used || '--';
        const diskTotal = stats.disk_total || '--';
        const diskPct = stats.disk_percent || 0;
        if (diskText) diskText.textContent = `${diskUsed} / ${diskTotal} (${diskPct}%)`;
        if (diskBar) {
            diskBar.style.width = `${Math.min(diskPct, 100)}%`;
            diskBar.style.background = diskPct > 85 ? 'linear-gradient(90deg, #f59e0b, #ef4444)' : 'linear-gradient(90deg, #34d399, #10b981)';
        }

        // Disk Təmizlənən Pay (Tünd Yaşıl Zolaq)
        if (beforeStats && (beforeStats.disk_percent || 0) > diskPct) {
            const oldDiskPct = beforeStats.disk_percent || 0;
            const freedPct = oldDiskPct - diskPct;
            if (diskFreedBar && freedPct > 0) {
                diskFreedBar.style.display = 'block';
                diskFreedBar.style.left = `${diskPct}%`;
                diskFreedBar.style.width = `${freedPct}%`;
            }
            if (diskLegend) {
                diskLegend.style.display = 'block';
                diskLegend.innerHTML = `🧹 <strong>Təmizlənən sahə:</strong> Əvvəl: ${beforeStats.disk_used} (${oldDiskPct}%) ➔ İndi: ${diskUsed} (${diskPct}%) — <span style="color: #10b981; font-weight: 700;">-${freedPct}% yer azad edildi!</span> (şkalada tünd yaşıl zolaqla göstərilib)`;
            }
        } else if (!beforeStats) {
            if (diskFreedBar) diskFreedBar.style.display = 'none';
            if (diskLegend) diskLegend.style.display = 'none';
        }

        return stats;
    } catch (e) {
        if (ramText) ramText.textContent = 'Əlçatmaz';
        if (diskText) diskText.textContent = 'Əlçatmaz';
        return null;
    }
}

// Təmizləmə Prosesini Başlatmaq
async function startServerCleanProcess(btn) {
    const select = document.getElementById('clean-modal-server-select');
    if (!select || !select.value) {
        showToast('Zəhmət olmasa təmizlənəcək serveri seçin.', 'warning');
        return;
    }

    const serverId = select.value;
    const serverName = select.options[select.selectedIndex]?.text || serverId;
    const term = document.getElementById('clean-terminal-console');
    const termStatus = document.getElementById('clean-terminal-status');
    const diffResult = document.getElementById('clean-diff-result');

    const cleanDocker = document.getElementById('clean-opt-docker')?.checked ?? true;
    const cleanSystem = document.getElementById('clean-opt-system')?.checked ?? true;
    const cleanDb = document.getElementById('clean-opt-db')?.checked ?? true;
    const days = parseInt(document.getElementById('bg-input-autoclean-days')?.value || '30');

    if (!cleanDocker && !cleanSystem && !cleanDb) {
        showToast('Ən azı 1 təmizləmə seçimi qeyd olunmalıdır!', 'warning');
        return;
    }

    // Təmizləmədən əvvəlki son statistikanı yadda saxlayırıq
    const beforeStats = cleanModalCurrentStats;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Təmizlənir...';
    }
    if (termStatus) {
        termStatus.textContent = '🔄 Təmizləmə gedir...';
        termStatus.style.color = '#f59e0b';
    }
    if (diffResult) diffResult.style.display = 'none';

    // Canlı nöqtə animasiyası (bir-bir artıb sonra azalan və başdan başlayan dövrə)
    let dotCount = 1;
    let increasing = true;
    const maxDots = 7;
    const minDots = 1;

    const renderAnimFrame = () => {
        if (!term) return;
        const dots = '.'.repeat(dotCount);
        term.textContent = `[Sistem] '${serverName}' üçün əlaqə qurulur və təmizləmə skripti işə salınır...\nZəhmət olmasa gözləyin${dots}\n----------------------------------------\n`;
        if (termStatus) {
            termStatus.textContent = `🔄 Təmizləmə gedir${dots}`;
        }
    };

    renderAnimFrame();

    let cleanAnimInterval = setInterval(() => {
        if (increasing) {
            dotCount++;
            if (dotCount >= maxDots) {
                increasing = false;
            }
        } else {
            dotCount--;
            if (dotCount <= minDots) {
                increasing = true;
            }
        }
        renderAnimFrame();
    }, 280);

    try {
        const res = await fetch(`/api/servers/${serverId}/clean`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clean_docker_cache: cleanDocker,
                clean_apt_logs: cleanSystem,
                clean_db_deployments: cleanDb,
                autoclean_days: days
            })
        });

        const data = await res.json();

        if (cleanAnimInterval) {
            clearInterval(cleanAnimInterval);
            cleanAnimInterval = null;
        }

        if (term) {
            term.textContent = (data.logs || 'Təmizləmə başa çatdı.') + `\n\n[Məlumat Bazası] Silinən köhnə qeydlər: ${data.db_deleted || 0} ədəd`;
            term.scrollTop = term.scrollHeight;
        }

        if (termStatus) {
            termStatus.textContent = '✅ Uğurla tamamlandı';
            termStatus.style.color = '#34d399';
        }

        showToast(`'${serverName}' serveri uğurla təmizləndi! 🎉`, 'success');

        // Təmizləmədən sonrakı yeni resurs göstəricilərini oxuyuruq
        await new Promise(r => setTimeout(r, 1000));
        const afterStats = await refreshCleanModalStats(beforeStats);

        // Azad olunan yer və RAM fərqini hesablayıb göstəririk
        if (diffResult) {
            let diffHtml = `<strong>🎉 Təmizləmə Nəticəsi:</strong><br>`;
            if (beforeStats && afterStats) {
                const ramFreed = (beforeStats.used_ram_mb || 0) - (afterStats.used_ram_mb || 0);
                const ramMsg = ramFreed > 0 
                    ? `<span style="color: #38bdf8;">🧠 Boşalan RAM: +<strong>${ramFreed} MB</strong> (əvvəl: ${beforeStats.used_ram_mb} MB ➔ indi: ${afterStats.used_ram_mb} MB)</span><br>`
                    : `<span>🧠 RAM dəyişimi: Stabil (${afterStats.used_ram_mb} MB)</span><br>`;

                const diskMsg = `<span>💾 Disk vəziyyəti: <strong>${afterStats.disk_used} / ${afterStats.disk_total}</strong> (əvvəl: ${beforeStats.disk_used} ➔ indi: ${afterStats.disk_used})</span><br>`;
                const dbMsg = `<span style="color: #a5b4fc;">🗄️ Təmizlənən köhnə deployment qeydləri: <strong>${data.db_deleted || 0}</strong> ədəd</span>`;

                diffHtml += ramMsg + diskMsg + dbMsg;
            } else {
                diffHtml += `Serverdə keşlər, artıq konteynerlər və jurnallar uğurla təmizləndi! Silinən DB qeydləri: ${data.db_deleted || 0}`;
            }
            diffResult.innerHTML = diffHtml;
            diffResult.style.display = 'block';
        }

        if (typeof loadBackgroundActivityLogs === 'function') {
            loadBackgroundActivityLogs();
        }
    } catch (e) {
        if (term) term.textContent += `\n[XƏTA] ${e.message}`;
        if (termStatus) {
            termStatus.textContent = '❌ Xəta baş verdi';
            termStatus.style.color = '#ef4444';
        }
        showToast('Təmizləmə zamanı xəta: ' + e.message, 'error');
    } finally {
        if (cleanAnimInterval) {
            clearInterval(cleanAnimInterval);
            cleanAnimInterval = null;
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span>🧹 Təmizləməyə Başla</span>';
        }
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
        let apps = await res.json();
        // İkinci cədvəl "Canlı Layihələrin Vəziyyəti və Tunel Əlaqələri" adlanır,
        // masterdeploy-watchdog daxili servisdir və tunellə əlaqəsi olmadığı üçün bu cədvələ daxil edilmir:
        apps = apps.filter(app => !app.name.toLowerCase().includes('watchdog') && !app.id.includes('watchdog'));
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
function refreshActiveBgTab() {
    if (currentBgSubTab === 'autodeploy') {
        if (typeof loadAutoDeployCenter === 'function') loadAutoDeployCenter();
    } else if (currentBgSubTab === 'watchdog') {
        if (typeof loadBackgroundServicesSettings === 'function') loadBackgroundServicesSettings();
        if (typeof loadBackgroundAppsOverview === 'function') loadBackgroundAppsOverview();
    } else if (currentBgSubTab === 'tunnels') {
        if (typeof loadMultiNodeTunnelsOverview === 'function') loadMultiNodeTunnelsOverview();
    } else if (currentBgSubTab === 'logs') {
        if (typeof loadBackgroundActivityLogs === 'function') loadBackgroundActivityLogs();
    }
}

function triggerActiveBgAction(btn) {
    if (currentBgSubTab === 'autodeploy') {
        if (typeof triggerCheckAllAutoDeploy === 'function') triggerCheckAllAutoDeploy(btn);
    } else if (currentBgSubTab === 'watchdog') {
        if (typeof saveBackgroundServicesSettings === 'function') saveBackgroundServicesSettings();
    } else if (currentBgSubTab === 'tunnels') {
        if (typeof loadMultiNodeTunnelsOverview === 'function') loadMultiNodeTunnelsOverview();
    }
}

// --- Canlı Təmizləmə Terminalı Köməkçi Funksiyaları ---
function copyCleanTerminalLogs() {
    const term = document.getElementById('clean-terminal-console');
    if (!term) return;
    const text = term.textContent || '';
    if (!text.trim()) {
        showToast('Kopyalanacaq loq yoxdur.', 'info');
        return;
    }
    navigator.clipboard.writeText(text).then(() => {
        showToast('Terminal loqları panoya kopyalandı! 📋', 'success');
    }).catch(() => {
        // Fallback
        try {
            const temp = document.createElement('textarea');
            temp.value = text;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand('copy');
            document.body.removeChild(temp);
            showToast('Terminal loqları panoya kopyalandı! 📋', 'success');
        } catch (e) {
            showToast('Kopyalamaq mümkün olmadı.', 'error');
        }
    });
}

function clearCleanTerminalLogs() {
    const term = document.getElementById('clean-terminal-console');
    const termStatus = document.getElementById('clean-terminal-status');
    if (term) {
        term.textContent = '[Konsol təmizləndi. Yeni əməliyyat gözlənilir.]';
    }
    if (termStatus) {
        termStatus.textContent = 'Təmizləndi';
        termStatus.style.color = '#64748b';
    }
    showToast('Terminal ekranı təmizləndi. 🧹', 'info');
}

window.copyCleanTerminalLogs = copyCleanTerminalLogs;
window.clearCleanTerminalLogs = clearCleanTerminalLogs;

// ==========================================================================
// Tünel Link Tarixçəsi və Fəaliyyət İnteqrasiyası
// ==========================================================================
async function openTunnelLinkHistoryModal(appId, appName) {
    let backdrop = document.getElementById('tunnel-history-modal');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'tunnel-history-modal';
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
            <div class="modal-card" style="max-width: 760px; width: 95%; max-height: 85vh; display: flex; flex-direction: column;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--card-border);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(56, 189, 248, 0.12); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <i data-lucide="history" style="width: 18px; height: 18px; color: #38bdf8;"></i>
                        </div>
                        <div>
                            <h3 id="hist-modal-title" style="margin: 0; font-size: 1.1rem; color: #fff;">Keçid Link Tarixçəsi</h3>
                            <p id="hist-modal-subtitle" style="margin: 2px 0 0; font-size: 0.78rem; color: var(--text-secondary);">Linklərin təyin olunma və qüvvədən düşmə vaxtları</p>
                        </div>
                    </div>
                </div>

                <div style="padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,210,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.05); gap: 10px; flex-wrap: wrap;">
                    <div id="hist-modal-app-badge" style="display: flex; align-items: center; gap: 6px; font-size: 0.82rem;">
                        <span style="color: var(--text-secondary);">Layihə:</span>
                        <strong id="hist-modal-app-name" style="color: #00d2ff;">-</strong>
                    </div>
                    <button id="hist-modal-jump-activity-btn" class="btn btn-secondary btn-xs" style="color: #a78bfa; border-color: rgba(167,139,250,0.3); font-size: 0.76rem; padding: 4px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;">
                        <i data-lucide="list" style="width: 12px; height: 12px;"></i>
                        <span>Fəaliyyət Jurnalında Loqlara Bax</span>
                    </button>
                </div>

                <div id="tunnel-history-list" style="flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 10px;">
                    <div style="text-align: center; color: var(--text-secondary); padding: 30px; font-size: 0.85rem;">Yüklənir...</div>
                </div>

                <div style="display: flex; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid var(--card-border);">
                    <button class="btn btn-secondary" onclick="closeModal('tunnel-history-modal')" style="font-size: 0.82rem; padding: 6px 16px;">Bağla</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);
    }

    const appNameEl = document.getElementById('hist-modal-app-name');
    const jumpBtn = document.getElementById('hist-modal-jump-activity-btn');
    const listEl = document.getElementById('tunnel-history-list');

    if (appNameEl) appNameEl.textContent = appName;
    if (jumpBtn) {
        jumpBtn.onclick = () => {
            closeModal('tunnel-history-modal');
            showActivityLogsForApp(appName);
        };
    }

    if (listEl) {
        listEl.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 30px; font-size: 0.85rem;"><span style="display:inline-block; animation: spin 1s linear infinite;">⏳</span> Tarixçə məlumatları gətirilir...</div>';
    }

    if (typeof showModal === 'function') {
        showModal('tunnel-history-modal');
    } else {
        backdrop.style.display = 'flex';
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }

    try {
        const res = await fetch(`/api/tunnels/history/${appId}`);
        if (!res.ok) throw new Error('Status ' + res.status);
        const history = await res.json();

        if (!history || history.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; padding: 35px 20px; background: rgba(255,255,255,0.015); border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px;">
                    <div style="width: 44px; height: 44px; border-radius: 50%; background: rgba(255,255,255,0.04); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 8px;">
                        <i data-lucide="history" style="width: 22px; height: 22px; color: #64748b;"></i>
                    </div>
                    <p style="margin: 0; color: #cbd5e1; font-size: 0.88rem; font-weight: 500;">Hələ ki qeydə alınmış link dəyişikliyi yoxdur.</p>
                    <p style="margin: 5px 0 0; color: var(--text-secondary); font-size: 0.78rem;">Bu layihə üçün yeni tünel linki təyin edildikdə və ya dəyişdikdə bütün tarixçə və vaxtlar burada saxlanılacaq.</p>
                </div>
            `;
            if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
            return;
        }

        listEl.innerHTML = history.map(item => {
            const isActive = item.status === 'active';
            const statusColor = isActive ? '#00e676' : '#94a3b8';
            const statusBg = isActive ? 'rgba(0,230,118,0.07)' : 'rgba(255,255,255,0.03)';
            const statusBorder = isActive ? 'rgba(0,230,118,0.25)' : 'rgba(255,255,255,0.06)';
            const statusLabel = isActive 
                ? '<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:#00e676;box-shadow:0 0 6px #00e676;"></span>Aktiv Canlı Link</span>' 
                : (item.status === 'stopped' 
                    ? '<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;"></span>Dayandırılıb</span>' 
                    : '<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:#94a3b8;"></span>Qüvvədən Düşüb</span>');

            let assignedTimeFormatted = item.assigned_at || '-';
            let expiredTimeFormatted = item.expired_at || (isActive ? 'Hazırda aktivdir' : '-');

            return `
                <div style="background: ${statusBg}; border: 1px solid ${statusBorder}; border-radius: 10px; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; transition: all 0.2s;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span style="font-size: 0.75rem; font-weight: 700; color: ${statusColor}; text-transform: uppercase; background: rgba(0,0,0,0.3); padding: 2px 8px; border-radius: 4px;">
                            ${statusLabel}
                        </span>
                        <div style="font-size: 0.72rem; color: var(--text-secondary); font-family: monospace; display: inline-flex; align-items: center; gap: 4px;">
                            <i data-lucide="calendar" style="width: 12px; height: 12px; color: #94a3b8;"></i>
                            <span>Təyin tarixi:</span>
                            <strong style="color: #cbd5e1;">${assignedTimeFormatted}</strong>
                        </div>
                    </div>

                    <!-- Yeni Təyin Olunan Link -->
                    <div style="display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,0.35); padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
                        <span style="font-size: 0.75rem; color: #38bdf8; font-weight: 600; flex-shrink: 0;">Link:</span>
                        <a href="${item.new_url}" target="_blank" style="color: #00d2ff; font-family: monospace; font-size: 0.78rem; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${item.new_url}">
                            ${item.new_url}
                        </a>
                        <button class="btn btn-secondary btn-xs" onclick="navigator.clipboard.writeText('${item.new_url}'); showToast('Link kopyalandı', 'info');" style="padding: 2px 6px; font-size: 0.65rem; display: inline-flex; align-items: center;">
                            <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                        </button>
                    </div>

                    <!-- Əgər Köhnə Link Varsa -->
                    ${item.previous_url ? `
                        <div style="display: flex; align-items: center; gap: 6px; font-size: 0.73rem; color: #94a3b8; padding: 0 4px;">
                            <i data-lucide="corner-down-left" style="width: 12px; height: 12px; color: #f87171; flex-shrink: 0;"></i>
                            <span style="color: #f87171; flex-shrink: 0;">Əvvəlki link:</span>
                            <span style="font-family: monospace; text-decoration: line-through; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                                ${item.previous_url}
                            </span>
                        </div>
                    ` : ''}

                    <!-- Qüvvədən Düşmə Vaxtı -->
                    ${!isActive && item.expired_at ? `
                        <div style="font-size: 0.72rem; color: #f87171; display: flex; align-items: center; gap: 5px; padding-top: 2px;">
                            <i data-lucide="clock" style="width: 12px; height: 12px; color: #f87171;"></i>
                            <span>Qüvvədən düşmə tarixi:</span>
                            <strong style="font-family: monospace;">${expiredTimeFormatted}</strong>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    } catch (e) {
        console.error('Tünel link tarixçəsi xətası:', e);
        if (listEl) {
            listEl.innerHTML = `<div style="color: #ff5252; padding: 20px; text-align: center; font-size: 0.82rem;">Tarixçə yüklənərkən xəta: ${e.message}</div>`;
        }
    }
}

function showActivityLogsForApp(appName) {
    if (typeof showModal === 'function') {
        showModal('activity-log-modal');
    }
    setTimeout(() => {
        const sel = document.getElementById('activity-project-filter');
        if (sel) {
            sel.value = appName;
        }
        if (typeof activityLogsState !== 'undefined') {
            activityLogsState.projectFilter = appName;
            if (typeof filterAndRenderActivityLogs === 'function') {
                filterAndRenderActivityLogs();
            }
        }
    }, 150);
}

window.openTunnelLinkHistoryModal = openTunnelLinkHistoryModal;
window.showActivityLogsForApp = showActivityLogsForApp;
