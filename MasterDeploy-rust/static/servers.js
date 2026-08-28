// =====================================================
// servers.js — Server idarəetməsinin tam JS modulu
// Pəncərə yöneticisindən asılı olmayan müstəqil overlay-lər
// =====================================================

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

function handleServerKeySelect(selectId, wrapperId) {
    const select = document.getElementById(selectId);
    const wrapper = document.getElementById(wrapperId);
    if (!select || !wrapper) return;
    
    // Əgər heç bir açar seçilməyibsə (əllə daxil etmə) textarea-nı göstər
    if (!select.value) {
        wrapper.style.display = 'block';
    } else {
        wrapper.style.display = 'none';
    }
}

function srvShowOverlay(id) {
    const el = document.getElementById(id);
    if (el) {
        if (el.parentElement !== document.body) {
            document.body.appendChild(el);
        }
        el.style.display = 'flex';
        el.style.zIndex = '999999';
        if (id === 'srv-add-overlay') {
            loadSshKeysDropdown('srv-key-id');
        }
        const handler = (e) => {
            if (e.key === 'Escape') {
                srvHideOverlay(id);
                document.removeEventListener('keydown', handler);
            }
        };
        document.addEventListener('keydown', handler);
    }
}

function srvHideOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

async function loadServers() {
    try {
        const res = await fetch('/api/servers');
        const servers = await res.json();

        const serversList = document.getElementById('servers-list');
        const serverSelect = document.getElementById('app-server');

        const statCountEl = document.getElementById('stat-servers-count');
        if (statCountEl) {
            statCountEl.innerText = servers.length;
        }

        if (!serversList) return;

        if (servers.length === 0) {
            serversList.innerHTML = `<div class="no-data">Hələ heç bir server əlavə edilməyib.</div>`;
            if (serverSelect) serverSelect.innerHTML = `<option value="">Öncə server əlavə edin</option>`;
            return;
        }

        if (serverSelect) {
            serverSelect.innerHTML = servers.map(s => `<option value="${s.id}">${s.name} (${s.ip})</option>`).join('');
        }

        currentServersList = servers;
        if (!currentSelectedServerId || !servers.some(s => s.id === currentSelectedServerId)) {
            currentSelectedServerId = servers[0].id;
        }

        const selectedServer = servers.find(s => s.id === currentSelectedServerId);
        const labelEl = document.getElementById('selected-server-label');
        if (labelEl && selectedServer) {
            labelEl.innerText = `Seçilib: ${selectedServer.name}`;
        }

        serversList.innerHTML = servers.map(s => {
            const isSelected = s.id === currentSelectedServerId;
            const selectedClass = isSelected ? 'selected-server-card' : '';
            return `
            <div class="list-item server-card ${selectedClass}" data-server-id="${s.id}" onclick="selectServer('${s.id}')" style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.6rem 1rem; border-radius: 10px; cursor: pointer; transition: all 0.2s; background: var(--card-bg); border: 1px solid var(--card-border); flex-wrap: wrap;">
                <!-- Left Section: Server Name, Badge & IP/User on 1 Line -->
                <div class="item-info" style="display: flex; align-items: center; gap: 0.6rem; min-width: 220px;">
                    <div style="width: 32px; height: 32px; background: rgba(0, 210, 255, 0.1); border: 1px solid rgba(0, 210, 255, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 1rem; flex-shrink: 0;">🖥️</div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <strong style="font-size: 0.95rem; color: #fff; white-space: nowrap;">${s.name}</strong>
                            <span id="status-${s.id}" class="server-status-badge" style="font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 10px; background: rgba(255,255,255,0.08); color: #aaa; cursor: pointer;" onclick="event.stopPropagation(); openServerConnModal('${s.id}')">🔌 Yoxla</span>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; margin-top: 0.1rem;">
                            <span><strong>IP:</strong> ${s.ip}</span> | <span><strong>İstifadəçi:</strong> ${s.ssh_user}</span>
                        </div>
                    </div>
                </div>

                <!-- Right Section: 4 Compact Metrics Side by Side in 1 Horizontal Line -->
                <div id="server-metrics-${s.id}" class="server-metrics-grid" style="display: flex; align-items: center; gap: 0.5rem; flex-grow: 1; justify-content: flex-end; max-width: 750px;">
                    <!-- RAM -->
                    <div style="flex: 1; min-width: 110px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 0.35rem 0.6rem; border-radius: 6px;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.7rem; margin-bottom: 0.15rem;">
                            <span style="color: var(--text-secondary);">🧠 RAM</span>
                            <span id="ram-pct-${s.id}" style="color: #00d2ff; font-weight: 600;">--%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; margin-bottom: 0.15rem;">
                            <div id="ram-bar-${s.id}" style="width: 0%; height: 100%; background: linear-gradient(90deg, #00d2ff, #3b82f6); transition: width 0.4s;"></div>
                        </div>
                        <div id="ram-val-${s.id}" style="font-size: 0.65rem; color: #aaa; text-align: right;">-- / -- MB</div>
                    </div>

                    <!-- SWAP -->
                    <div style="flex: 1; min-width: 110px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 0.35rem 0.6rem; border-radius: 6px;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.7rem; margin-bottom: 0.15rem;">
                            <span style="color: var(--text-secondary);">🔄 SWAP</span>
                            <span id="swap-pct-${s.id}" style="color: #a78bfa; font-weight: 600;">--%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; margin-bottom: 0.15rem;">
                            <div id="swap-bar-${s.id}" style="width: 0%; height: 100%; background: linear-gradient(90deg, #a78bfa, #8b5cf6); transition: width 0.4s;"></div>
                        </div>
                        <div id="swap-val-${s.id}" style="font-size: 0.65rem; color: #aaa; text-align: right;">-- / -- MB</div>
                    </div>

                    <!-- CPU -->
                    <div style="flex: 1; min-width: 100px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 0.35rem 0.6rem; border-radius: 6px;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.7rem; margin-bottom: 0.15rem;">
                            <span style="color: var(--text-secondary);">⚡ CPU</span>
                            <span id="cpu-pct-${s.id}" style="color: #4ade80; font-weight: 600;">--%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; margin-bottom: 0.15rem;">
                            <div id="cpu-bar-${s.id}" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4ade80, #22c55e); transition: width 0.4s;"></div>
                        </div>
                        <div id="cpu-val-${s.id}" style="font-size: 0.65rem; color: #aaa; text-align: right;">-- Nüvə</div>
                    </div>

                    <!-- DISK -->
                    <div style="flex: 1; min-width: 120px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); padding: 0.35rem 0.6rem; border-radius: 6px;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.7rem; margin-bottom: 0.15rem;">
                            <span style="color: var(--text-secondary);">💾 DISK</span>
                            <span id="disk-pct-${s.id}" style="color: #facc15; font-weight: 600;">--%</span>
                        </div>
                        <div style="width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; margin-bottom: 0.15rem;">
                            <div id="disk-bar-${s.id}" style="width: 0%; height: 100%; background: linear-gradient(90deg, #facc15, #eab308); transition: width 0.4s;"></div>
                        </div>
                        <div id="disk-val-${s.id}" style="font-size: 0.65rem; color: #aaa; text-align: right;">-- / --</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Automatically load metrics for each server card
        servers.forEach(s => loadServerLiveMetrics(s.id));

        if (document.body.classList.contains('debug-mode')) {
            updateDebugDimensions();
        }
    } catch (e) {
        console.error("Failed to load servers", e);
    }
}

async function loadServerLiveMetrics(serverId) {
    try {
        const res = await fetch(`/api/servers/${serverId}/stats`);
        if (!res.ok) return;
        const data = await res.json();
        
        // RAM
        const ramPct = data.ram_percent || 0;
        const ramBar = document.getElementById(`ram-bar-${serverId}`);
        const ramPctEl = document.getElementById(`ram-pct-${serverId}`);
        const ramValEl = document.getElementById(`ram-val-${serverId}`);
        if (ramBar) ramBar.style.width = `${Math.min(ramPct, 100)}%`;
        if (ramPctEl) ramPctEl.innerText = `${ramPct}%`;
        if (ramValEl) ramValEl.innerText = `${data.used_ram_mb || 0} / ${data.total_ram_mb || 0} MB`;

        // SWAP
        const swapPct = data.swap_percent || 0;
        const swapBar = document.getElementById(`swap-bar-${serverId}`);
        const swapPctEl = document.getElementById(`swap-pct-${serverId}`);
        const swapValEl = document.getElementById(`swap-val-${serverId}`);
        if (swapBar) swapBar.style.width = `${Math.min(swapPct, 100)}%`;
        if (swapPctEl) swapPctEl.innerText = `${swapPct}%`;
        if (swapValEl) swapValEl.innerText = `${data.used_swap_mb || 0} / ${data.total_swap_mb || 0} MB`;

        // CPU
        const cpuPct = data.cpu_percent || 0;
        const cpuBar = document.getElementById(`cpu-bar-${serverId}`);
        const cpuPctEl = document.getElementById(`cpu-pct-${serverId}`);
        const cpuValEl = document.getElementById(`cpu-val-${serverId}`);
        if (cpuBar) cpuBar.style.width = `${Math.min(cpuPct, 100)}%`;
        if (cpuPctEl) cpuPctEl.innerText = `${cpuPct}%`;
        if (cpuValEl) cpuValEl.innerText = `${data.cores || 1} Nüvə`;

        // DISK
        const diskPct = data.disk_percent || 0;
        const diskBar = document.getElementById(`disk-bar-${serverId}`);
        const diskPctEl = document.getElementById(`disk-pct-${serverId}`);
        const diskValEl = document.getElementById(`disk-val-${serverId}`);
        if (diskBar) diskBar.style.width = `${Math.min(diskPct, 100)}%`;
        if (diskPctEl) diskPctEl.innerText = `${diskPct}%`;
        if (diskValEl) diskValEl.innerText = `${data.disk_free || '--'} Boş (${data.disk_used || '--'} / ${data.disk_total || '--'})`;

    } catch (e) {
        console.error('Failed to load server live metrics', e);
    }
}

let currentSelectedServerId = null;
let currentServersList = [];

function selectServer(serverId) {
    currentSelectedServerId = serverId;
    
    // Highlight selected card with rotating glow animation class
    document.querySelectorAll('.server-card').forEach(card => {
        if (card.getAttribute('data-server-id') === serverId) {
            card.classList.add('selected-server-card');
        } else {
            card.classList.remove('selected-server-card');
        }
    });
}

function executeGlobalServerAction(action) {
    if (!currentSelectedServerId && currentServersList.length > 0) {
        selectServer(currentServersList[0].id);
    }
    if (!currentSelectedServerId) {
        showToast('Zəhmət olmasa siyahıdan bir server seçin', 'warning');
        return;
    }
    const server = currentServersList.find(s => s.id === currentSelectedServerId);
    if (!server) return;

    if (action === 'edit') editServer(server.id);
    else if (action === 'console') toggleServerConsole(server.id);
    else if (action === 'volumes') toggleServerVolumes(server.id);
    else if (action === 'delete') deleteServer(server.id, server.name);
    else if (action === 'check') checkConnection(server.id);
}

function openServerConnModal(serverId) {
    const targetId = serverId || currentSelectedServerId;
    if (!targetId) {
        showToast('Lütfən bir server seçin', 'warning');
        return;
    }
    const server = currentServersList.find(s => s.id === targetId);
    if (!server) return;

    document.getElementById('conn-server-id').value = server.id;
    document.getElementById('conn-server-name').value = `${server.name} (${server.ip})`;

    const settings = getServerConnSettings(server.id);
    document.getElementById('conn-retry-sec').value = settings.retrySec;
    document.getElementById('conn-max-retries').value = settings.maxRetries;
    document.getElementById('conn-pause-min').value = settings.pauseMin;

    showModal('server-conn-modal');
}

function getServerConnSettings(serverId) {
    try {
        const raw = localStorage.getItem(`server_conn_${serverId}`);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return { retrySec: 15, maxRetries: 3, pauseMin: 5 };
}

function saveServerConnSettings(e) {
    e.preventDefault();
    const id = document.getElementById('conn-server-id').value;
    const retrySec = parseInt(document.getElementById('conn-retry-sec').value) || 15;
    const maxRetries = parseInt(document.getElementById('conn-max-retries').value) || 3;
    const pauseMin = parseInt(document.getElementById('conn-pause-min').value) || 5;

    const settings = { retrySec, maxRetries, pauseMin };
    localStorage.setItem(`server_conn_${id}`, JSON.stringify(settings));

    closeModal('server-conn-modal');
    showToast('Bağlantı tənzimləmələri yadda saxlanıldı!', 'success');

    // Trigger connection check with new settings
    checkConnection(id);
}

let currentModalServerId = null;

function toggleServerConsole(serverId) {
    const server = currentServersList.find(s => s.id === serverId);
    if (!server) return;
    currentModalServerId = serverId;

    const titleNameEl = document.getElementById('modal-console-server-name');
    if (titleNameEl) titleNameEl.innerText = `${server.name} (${server.ip})`;

    const container = document.getElementById('modal-console-container');
    if (container) {
        container.innerHTML = serverConsoleLogs[serverId] || `[Sistem] "${server.name}" serverinin konsolu aktivdir. Qoşulma yoxlanarkən çıxan loqlar burada görünəcək.`;
        container.style.color = '#4ade80';
    }
    showModal('server-console-modal');
}

function copyServerConsoleModal(btn) {
    const el = document.getElementById('modal-console-container');
    if (!el) return;
    const text = el.innerText || el.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = '✅ Kopyalandı!';
                setTimeout(() => { btn.innerHTML = orig; }, 2000);
            }
        });
    }
}

function clearServerConsoleModal() {
    const el = document.getElementById('modal-console-container');
    if (el) el.innerText = '[Sistem] Konsol təmizləndi.\n';
}

function toggleServerVolumes(serverId) {
    const server = currentServersList.find(s => s.id === serverId);
    if (!server) return;
    currentModalServerId = serverId;

    const titleNameEl = document.getElementById('modal-volumes-server-name');
    if (titleNameEl) titleNameEl.innerText = `${server.name} (${server.ip})`;
    showModal('server-volumes-modal');
    loadServerVolumes(serverId);
}

function reloadModalVolumes() {
    if (currentModalServerId) {
        loadServerVolumes(currentModalServerId);
    }
}

async function loadServerVolumes(serverId) {
    const container = document.getElementById('modal-volumes-container');
    if (!container) return;
    container.innerHTML = '<div style="color:#888; padding: 15px;">Docker volumları oxunur, zəhmət olmasa gözləyin...</div>';

    try {
        const res = await fetch(`/api/servers/${serverId}/volumes`);
        if (!res.ok) {
            const err = await res.text();
            container.innerHTML = `<div style="color:#ff1744; padding: 10px;">Xəta: ${err}</div>`;
            return;
        }

        const data = await res.json();
        const volumes = data.volumes || [];
        const containers = data.containers || [];
        const disk = data.disk || { total: 'Unknown', free: 'Unknown', used_percent: 'Unknown' };
        const formatVolumeSize = (sizeStr) => {
            if (!sizeStr) return '0 B';
            const clean = sizeStr.trim();
            if (clean.endsWith('K') || clean.endsWith('kB')) return clean.replace(/kB|K/i, ' KB');
            if (clean.endsWith('M') || clean.endsWith('MB')) return clean.replace(/MB|M/i, ' MB');
            if (clean.endsWith('G') || clean.endsWith('GB')) return clean.replace(/GB|G/i, ' GB');
            if (clean.endsWith('B')) return clean;
            if (/^\d+$/.test(clean)) return clean + ' B';
            return clean;
        };

        let diskBannerHtml = '';
        if (disk.total !== 'Unknown') {
            diskBannerHtml = `
                <div style="background: rgba(0, 210, 255, 0.05); border: 1px solid rgba(0, 210, 255, 0.15); padding: 0.6rem 1rem; border-radius: 6px; margin-bottom: 12px; font-size: 0.82rem; color: #cbd5e1; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                    <span>📊 Ümumi Disk: <strong>${disk.total}</strong></span>
                    <span>💾 Boş Yaddaş: <strong style="color: #00e676;">${disk.free}</strong></span>
                    <span>📈 Doluluq: <strong style="color: #ff9800;">${disk.used_percent}</strong></span>
                </div>
            `;
        }

        // Tab düymələri
        let tabsHtml = `
            <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; border-bottom: 1px solid var(--card-border); padding-bottom: 0.5rem;">
                <button id="tab-btn-vols-${serverId}" class="btn" style="padding: 0.3rem 0.8rem; font-size: 0.75rem; background: var(--accent-color); color: #000;" onclick="switchServerVolumeTab('${serverId}', 'vols')">💾 Volumlar (Datalar)</button>
                <button id="tab-btn-conts-${serverId}" class="btn btn-secondary" style="padding: 0.3rem 0.8rem; font-size: 0.75rem;" onclick="switchServerVolumeTab('${serverId}', 'conts')">📦 Layihələr & Konteynerlər</button>
            </div>
        `;

        // 1. Volumlar Cədvəli
        let volsTableHtml = `
            <div id="tab-content-vols-${serverId}" style="display: block;">
        `;
        if (volumes.length === 0) {
            volsTableHtml += '<div style="color:#888; padding: 10px;">Serverdə heç bir Docker volume tapılmadı.</div>';
        } else {
            volsTableHtml += `
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--card-border); color: var(--text-secondary); font-weight: bold;">
                            <th style="padding: 8px 4px;">Volume Adı</th>
                            <th style="padding: 8px 4px;">Drayver</th>
                            <th style="padding: 8px 4px;">Disk Ölçüsü</th>
                            <th style="padding: 8px 4px;">Bağlı Konteynerlər</th>
                            <th style="padding: 8px 4px; text-align: right;">Əməliyyat</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            volumes.forEach(v => {
                const isUnused = !v.containers || v.containers.length === 0;
                const statusBadge = isUnused ? 
                    '<span style="color:#f59e0b; background:rgba(245,158,11,0.1); padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-left:8px;">Unused</span>' : '';
                
                const containerText = isUnused ? 
                    '<span style="color:#888;">Yoxdur</span>' : 
                    v.containers.map(c => `<code style="color:var(--accent-color);">${c}</code>`).join(', ');

                const deleteButton = isUnused ? 
                    `<button class="btn btn-secondary" onclick="deleteServerVolume('${serverId}', '${v.name}')" style="padding: 2px 6px; font-size: 0.7rem; background:rgba(255,0,0,0.1); color:#ff1744; border-color:rgba(255,0,0,0.2);">🗑️ Sil</button>` :
                    `<button class="btn btn-secondary" disabled style="padding: 2px 6px; font-size: 0.7rem; opacity: 0.3; cursor: not-allowed;" title="İstifadə olunan volumu silmək olmaz">🔒 Sil</button>`;

                volsTableHtml += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                        <td style="padding: 8px 4px; font-family: monospace; word-break: break-all;">
                            ${v.name} ${statusBadge}
                        </td>
                        <td style="padding: 8px 4px; color:#888;">${v.driver}</td>
                        <td style="padding: 8px 4px; font-weight: bold; color:#fff;">${formatVolumeSize(v.size)}</td>
                        <td style="padding: 8px 4px;">${containerText}</td>
                        <td style="padding: 8px 4px; text-align: right;">${deleteButton}</td>
                    </tr>
                `;
            });
            volsTableHtml += '</tbody></table>';
        }
        volsTableHtml += '</div>';

        // 2. Konteynerlər (Layihələr) Cədvəli
        let contsTableHtml = `
            <div id="tab-content-conts-${serverId}" style="display: none;">
        `;
        if (containers.length === 0) {
            contsTableHtml += '<div style="color:#888; padding: 10px;">Aktiv Docker konteyneri tapılmadı.</div>';
        } else {
            contsTableHtml += `
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--card-border); color: var(--text-secondary); font-weight: bold;">
                            <th style="padding: 8px 4px;">Layihə / Konteyner Adı</th>
                            <th style="padding: 8px 4px;">Faktiki Yaddaş (Image daxil)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            containers.forEach(c => {
                contsTableHtml += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                        <td style="padding: 8px 4px; font-weight: 500; color: #fff;">
                            📦 ${c.name}
                        </td>
                        <td style="padding: 8px 4px; font-family: monospace; color: #00d2ff;">
                            ${formatVolumeSize(c.size)}
                        </td>
                    </tr>
                `;
            });
            contsTableHtml += '</tbody></table>';
        }
        contsTableHtml += '</div>';

        container.innerHTML = diskBannerHtml + tabsHtml + volsTableHtml + contsTableHtml;

    } catch (e) {
        console.error("Failed to load server volumes", e);
        container.innerHTML = `<div style="color:#ff1744; padding: 10px;">Bağlantı xətası: ${e.message}</div>`;
    }
}

async function deleteServerVolume(serverId, volumeName) {
    if (!confirm(`"${volumeName}" volume-unu tamamilə silmək istədiyinizdən əminsiniz?`)) return;

    try {
        const res = await fetch(`/api/servers/${serverId}/volumes/${volumeName}`, { method: 'POST' });
        if (res.ok) {
            alert('Volume uğurla silindi!');
            loadServerVolumes(serverId);
        } else {
            const err = await res.text();
            alert(`Xəta: ${err}`);
        }
    } catch (e) {
        alert(`Qoşulma xətası: ${e.message}`);
    }
}

function copyServerVolumes(serverId, btn) {
    const container = document.getElementById(`volumes-container-${serverId}`);
    if (!container) return;
    const text = container.innerText;
    navigator.clipboard.writeText(text).then(() => {
        const originalText = btn.innerText;
        btn.innerText = '✅ Kopyalandı!';
        setTimeout(() => { btn.innerText = originalText; }, 2000);
    }).catch(err => {
        alert('Kopyalamaq mümkün olmadı: ' + err);
    });
}

function clearServerVolumes(serverId) {
    const container = document.getElementById(`volumes-container-${serverId}`);
    if (container) {
        container.innerHTML = '<div style="color:#888; padding: 10px;">Təmizləndi. Yeniləmək üçün "🔄 Yenilə" düyməsinə klikləyin.</div>';
    }
}

function switchServerVolumeTab(serverId, tabName) {
    const volsBtn = document.getElementById(`tab-btn-vols-${serverId}`);
    const contsBtn = document.getElementById(`tab-btn-conts-${serverId}`);
    const volsContent = document.getElementById(`tab-content-vols-${serverId}`);
    const contsContent = document.getElementById(`tab-content-conts-${serverId}`);

    if (tabName === 'vols') {
        if (volsContent) volsContent.style.display = 'block';
        if (contsContent) contsContent.style.display = 'none';
        if (volsBtn) {
            volsBtn.style.background = 'var(--accent-color)';
            volsBtn.style.color = '#000';
        }
        if (contsBtn) {
            contsBtn.style.background = 'transparent';
            contsBtn.style.color = 'var(--text-primary)';
        }
    } else {
        if (volsContent) volsContent.style.display = 'none';
        if (contsContent) contsContent.style.display = 'block';
        if (volsBtn) {
            volsBtn.style.background = 'transparent';
            volsBtn.style.color = 'var(--text-primary)';
        }
        if (contsBtn) {
            contsBtn.style.background = 'var(--accent-color)';
            contsBtn.style.color = '#000';
        }
    }
}



async function handleCreateServer(event) {
    event.preventDefault();
    const keySelect = document.getElementById('srv-key-id');
    const selectedKeyId = keySelect ? keySelect.value : '';
    const customKey = document.getElementById('srv-key') ? document.getElementById('srv-key').value : '';

    const payload = {
        name: document.getElementById('srv-name').value,
        ip: document.getElementById('srv-ip').value,
        ssh_user: document.getElementById('srv-ssh-user').value,
        ssh_key_id: selectedKeyId ? selectedKeyId : null,
        ssh_key: customKey || ''
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
        } else {
            const errText = await res.text();
            addActivityLog(`Server yaratma uğursuz: ${errText}`, 'error');
            showInfoCard('❌ Xəta', 'Server əlavə edilə bilmədi', errText);
        }
    } catch (e) {
        addActivityLog(`Server yaratma uğursuz: ${e.message}`, 'error');
        console.error("Failed to create server", e);
    }
}

// Edit server details (fetch and open modal)
async function editServer(id) {
    try {
        const res = await fetch(`/api/servers/${id}`);
        if (!res.ok) throw new Error("Server məlumatları alınmadı");
        const server = await res.json();

        if (document.getElementById('edit-srv-id')) document.getElementById('edit-srv-id').value = server.id || '';
        if (document.getElementById('edit-srv-name')) document.getElementById('edit-srv-name').value = server.name || '';
        if (document.getElementById('edit-srv-ip')) document.getElementById('edit-srv-ip').value = server.ip || '';
        if (document.getElementById('edit-srv-ssh-user')) document.getElementById('edit-srv-ssh-user').value = server.ssh_user || '';
        if (document.getElementById('edit-srv-key')) document.getElementById('edit-srv-key').value = server.ssh_key || '';

        // Load SSH keys into dropdown
        if (typeof loadSshKeysDropdown === 'function') {
            await loadSshKeysDropdown('edit-srv-key-id', server.ssh_key_id);
        }

        showModal('server-edit-modal');
    } catch (e) {
        console.error("Redaktə xətası", e);
        showInfoCard("❌ Xəta", "Server məlumatlarını yükləmək mümkün olmadı", e.message);
    }
}

// Handle server update submit
async function handleUpdateServer(event) {
    event.preventDefault();
    const id = document.getElementById('edit-srv-id').value;
    const keySelect = document.getElementById('edit-srv-key-id');
    const selectedKeyId = keySelect ? keySelect.value : '';
    const customKey = document.getElementById('edit-srv-key') ? document.getElementById('edit-srv-key').value : '';

    const payload = {
        name: document.getElementById('edit-srv-name').value,
        ip: document.getElementById('edit-srv-ip').value,
        ssh_user: document.getElementById('edit-srv-ssh-user').value,
        ssh_key_id: selectedKeyId ? selectedKeyId : null,
        ssh_key: customKey || ''
    };

    try {
        const res = await fetch(`/api/servers/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal('server-edit-modal');
            document.getElementById('server-edit-form').reset();
            addActivityLog(`Server redaktə edildi: ${payload.name} (${payload.ip})`, 'server');
            loadServers();
        } else {
            const err = await res.text();
            addActivityLog(`Server yeniləmə uğursuz: ${err}`, 'error');
            showInfoCard("❌ Xəta", "Serveri yeniləmək mümkün olmadı", err);
        }
    } catch (e) {
        addActivityLog(`Server yeniləmə xətası: ${e.message}`, 'error');
        console.error("Failed to update server", e);
        showInfoCard("❌ Xəta", "Bağlantı xətası", e.message);
    }
}

const serverRetryState = {};
const serverConsoleLogs = {};

function logToServerConsole(id, text, color = '#4ade80') {
    serverConsoleLogs[id] = text;
    if (currentModalServerId === id) {
        const container = document.getElementById('modal-console-container');
        if (container) {
            container.innerHTML = text;
            container.style.color = color;
        }
    }
}

// Check real server connection via backend SSH check with custom retry & pause loop
async function checkConnection(id) {
    const statusEl = document.getElementById(`status-${id}`);
    
    // Get user-customized settings for this server
    const settings = getServerConnSettings(id);
    const retrySec = settings.retrySec || 15;
    const maxRetries = settings.maxRetries || 3;
    const pauseMin = settings.pauseMin || 5;

    if (!serverRetryState[id]) {
        serverRetryState[id] = { failCount: 0, isPaused: false };
    }
    const state = serverRetryState[id];

    if (state.isPaused) {
        if (statusEl) {
            statusEl.innerHTML = `⏳ Fasilə (${pauseMin} dəq gözlənilir...)`;
            statusEl.style.color = '#facc15';
            statusEl.style.background = 'rgba(250, 204, 21, 0.1)';
        }
        return false;
    }

    if (statusEl) {
        statusEl.innerHTML = `⏳ Yoxlanılır...`;
        statusEl.style.color = '#ccc';
        statusEl.style.background = 'rgba(255,255,255,0.05)';
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`/api/servers/${id}/check`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                state.failCount = 0; // Reset fail count on success
                if (statusEl) {
                    statusEl.innerHTML = `Qoşulub ✅`;
                    statusEl.style.color = '#00e676';
                    statusEl.style.background = 'rgba(0, 230, 118, 0.1)';
                }
                logToServerConsole(id, `[${new Date().toLocaleTimeString()}] ✅ Bağlantı uğurludur!\nCavab: ${data.message}`, '#00e676');
                // Also trigger live metrics update
                loadServerLiveMetrics(id);
                return true;
            } else {
                throw new Error(data.error || 'Qoşulma xətası');
            }
        } else {
            throw new Error(`HTTP Error ${res.status}`);
        }
    } catch (e) {
        state.failCount++;
        let errMsg = e.message;
        if (e.name === 'AbortError') {
            errMsg = 'Bağlantı yoxlaması üçün gözləmə vaxtı bitdi (Timeout 15s).';
        }

        if (state.failCount >= maxRetries) {
            // Enter Pause state for pauseMin minutes
            state.isPaused = true;
            if (statusEl) {
                statusEl.innerHTML = `⏳ Fasilə (${pauseMin} dəq gözlənilir...)`;
                statusEl.style.color = '#facc15';
                statusEl.style.background = 'rgba(250, 204, 21, 0.1)';
            }
            logToServerConsole(id, `[${new Date().toLocaleTimeString()}] ❌ ${maxRetries} dəfə uğursuz cəhd. ${pauseMin} dəqiqə fasilə rejiminə keçildi.\nSon xəta: ${errMsg}`, '#ff1744');

            // Unpause after pauseMin minutes and reset failCount
            setTimeout(() => {
                state.isPaused = false;
                state.failCount = 0;
                checkConnection(id);
            }, pauseMin * 60 * 1000);

        } else {
            // Reconnecting state
            if (statusEl) {
                statusEl.innerHTML = `🔄 Qoşulur (${state.failCount}/${maxRetries} - ${retrySec}s)`;
                statusEl.style.color = '#ff9800';
                statusEl.style.background = 'rgba(255, 152, 0, 0.1)';
            }
            logToServerConsole(id, `[${new Date().toLocaleTimeString()}] ⚠️ Uğursuz cəhd ${state.failCount}/${maxRetries}. ${retrySec} saniyə sonra təkrar cəhd ediləcək...\nXəta: ${errMsg}`, '#ff9800');

            // Retry after retrySec seconds
            setTimeout(() => {
                checkConnection(id);
            }, retrySec * 1000);
        }

        return false;
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
    showToast(`"${name}" serverində avtomatik hazırlıq başladı...`, 'info');

    try {
        const res = await fetch(`/api/servers/${id}/setup`, { method: 'POST' });

        if (res.ok) {
            addActivityLog(`Server hazırlandı: ${name}`, 'setup');
            showInfoCard('✅ Uğurlu', `"${name}" serveri`, 'Docker uğurla quraşdırıldı. Artıq layihə yükləyə bilərsiniz.');
        } else {
            const err = await res.text();
            addActivityLog(`Server hazırlıq uğursuz: ${name}`, 'error');
            showInfoCard('❌ Xəta', 'Hazırlıq zamanı problem', err);
        }
    } catch (e) {
        console.error("Setup error", e);
        addActivityLog(`Server hazırlıq xətası: ${name}`, 'error');
        showInfoCard('❌ Bağlantı Xətası', 'Serverə qoşula bilmədi.', e.message);
    }
}

let activeSourceMode = 'manual';
let gitHubRepos = [];



// Global exports for inline HTML onclick handlers
window.srvShowOverlay = srvShowOverlay;
window.srvHideOverlay = srvHideOverlay;
window.loadServers = loadServers;
window.selectServer = selectServer;
window.executeGlobalServerAction = executeGlobalServerAction;
window.openServerConnModal = openServerConnModal;
window.toggleServerConsole = toggleServerConsole;
window.toggleServerVolumes = toggleServerVolumes;
window.reloadModalVolumes = reloadModalVolumes;
window.deleteServerVolume = deleteServerVolume;
window.deleteServer = deleteServer;
window.editServer = editServer;
window.checkConnection = checkConnection;
window.handleCreateServer = handleCreateServer;
window.handleUpdateServer = handleUpdateServer;
window.saveServerConnSettings = saveServerConnSettings;
window.handleServerKeySelect = handleServerKeySelect;
window.loadSshKeysDropdown = loadSshKeysDropdown;
window.copyServerConsoleModal = copyServerConsoleModal;
window.clearServerConsoleModal = clearServerConsoleModal;
window.switchServerVolumeTab = switchServerVolumeTab;


