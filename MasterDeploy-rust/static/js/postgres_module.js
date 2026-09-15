// PostgreSQL Database Manager Frontend Module

let currentPgServerId = null;
let currentPgStatus = null;

// Modalı açır və ilkin məlumatları yükləyir
// showModal özü loadPgServers + fetchMyIpAddress-i avtomatik çağırır (window_manager.js hooks)
async function openPostgresModal(preferredServerId = null) {
    // Əgər pəncərə artıq açıqdırsa, yalnız ön plana gətirib data-nı yenilə
    const backdrop = document.getElementById('postgres-modal');
    if (backdrop && backdrop.classList.contains('active')) {
        bringToFront('postgres-modal');
        await loadPgServers(preferredServerId);
        fetchMyIpAddress();
        return;
    }
    // showModal özü hook vasitəsilə loadPgServers + fetchMyIpAddress çağıracaq
    await showModal('postgres-modal');
    // preferredServerId varsa, açıldıqdan sonra tətbiq et
    if (preferredServerId) {
        const sel = document.getElementById('pg-server-select');
        if (sel && preferredServerId) {
            sel.value = preferredServerId;
            currentPgServerId = preferredServerId;
            await refreshPgStatus();
        }
    }
}

// Serverlərin siyahısını gətirir və dropdown-a doldurur
async function loadPgServers(preferredServerId = null) {
    const select = document.getElementById('pg-server-select');
    if (!select) return;

    select.innerHTML = '<option value="">Serverlər yüklənir...</option>';

    try {
        const resp = await fetch('/api/servers');
        if (!resp.ok) throw new Error('Serverləri yükləmək mümkün olmadı');
        const servers = await resp.json();

        if (!servers || servers.length === 0) {
            select.innerHTML = '<option value="">Heç bir server qoşulmayıb</option>';
            updatePgEngineStatusUI({ installed: false, running: false, not_found: true });
            return;
        }

        select.innerHTML = '';
        servers.forEach((s) => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${s.name} (${s.ip}) [${s.ssh_user}]`;
            select.appendChild(opt);
        });

        if (preferredServerId && servers.some(s => s.id === preferredServerId)) {
            select.value = preferredServerId;
        } else {
            const remoteServer = servers.find(s => s.ip !== 'local' && s.ip !== '127.0.0.1');
            select.value = remoteServer ? remoteServer.id : servers[0].id;
        }

        currentPgServerId = select.value;
        await refreshPgStatus();
    } catch (e) {
        console.error('loadPgServers xətası:', e);
        select.innerHTML = `<option value="">Xəta: ${e.message}</option>`;
    }
}

// Server dəyişdirildikdə
async function onPgServerSelectChange() {
    const select = document.getElementById('pg-server-select');
    if (!select || !select.value) return;
    currentPgServerId = select.value;
    // Əvvəlki nəticə qutusunu bağlayırıq
    const resBox = document.getElementById('pg-result-box');
    if (resBox) resBox.style.display = 'none';
    await refreshPgStatus();
}

// Seçilmiş serverdə PostgreSQL statusunu yoxlayır
async function refreshPgStatus() {
    if (!currentPgServerId) return;

    const dot = document.getElementById('pg-status-dot');
    const title = document.getElementById('pg-status-title');
    const sub = document.getElementById('pg-status-sub');
    const installWrapper = document.getElementById('pg-install-action-wrapper');
    const createSection = document.getElementById('pg-create-section');

    if (dot) dot.style.background = '#eab308';
    if (title) title.textContent = 'Mühərrik vəziyyəti yoxlanılır...';
    if (sub) sub.textContent = 'SSH vasitəsilə Docker konteyneri sorğulanır...';
    if (installWrapper) installWrapper.style.display = 'none';
    if (createSection) createSection.style.display = 'none';

    try {
        const resp = await fetch(`/api/plugins/postgres/status/${currentPgServerId}`);
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        currentPgStatus = data;

        updatePgEngineStatusUI(data);
        if (data.running) {
            await loadPgDatabases(currentPgServerId);
        }
    } catch (err) {
        console.error('refreshPgStatus xətası:', err);
        if (dot) dot.style.background = '#ef4444';
        if (title) title.textContent = 'Əlaqə Xətası';
        if (sub) sub.textContent = err.message || 'Serverə SSH ilə qoşulmaq mümkün olmadı';
    }
}

// UI status kartını yeniləyir
function updatePgEngineStatusUI(data) {
    const installWrapper = document.getElementById('pg-install-action-wrapper');
    const createSection = document.getElementById('pg-create-section');

    // Pəncərə çərçivəsinin üstünə (titlebar-a) zərif status pill əlavə edirik
    const winHeader = document.querySelector('#postgres-modal .win-header');
    let titlebarPill = null;
    if (winHeader) {
        titlebarPill = winHeader.querySelector('.pg-titlebar-pill');
        if (!titlebarPill) {
            titlebarPill = document.createElement('span');
            titlebarPill.className = 'pg-titlebar-pill';
            titlebarPill.style.cssText = 'font-size:10px; padding:1px 7px; border-radius:12px; font-weight:600; margin-left:8px; display:inline-flex; align-items:center; gap:4px; vertical-align:middle; line-height:1.4;';
            const titleArea = winHeader.querySelector('.win-title-text');
            if (titleArea) titleArea.appendChild(titlebarPill);
        }
    }

    if (data.not_found) {
        if (titlebarPill) {
            titlebarPill.style.background = 'rgba(239,68,68,0.12)';
            titlebarPill.style.border = '1px solid rgba(239,68,68,0.3)';
            titlebarPill.style.color = '#f87171';
            titlebarPill.innerHTML = '<span style="width:5px;height:5px;border-radius:50%;background:#ef4444;"></span> Server Tapılmadı';
        }
        if (createSection) createSection.style.display = 'none';
        return;
    }

    if (data.running) {
        if (titlebarPill) {
            titlebarPill.style.background = 'rgba(16,185,129,0.12)';
            titlebarPill.style.border = '1px solid rgba(16,185,129,0.3)';
            titlebarPill.style.color = '#34d399';
            titlebarPill.innerHTML = '<span style="width:5px;height:5px;border-radius:50%;background:#10b981;"></span> Aktiv (16-alpine)';
        }
        if (installWrapper) installWrapper.style.display = 'none';
        if (createSection) createSection.style.display = 'inline-flex';
    } else if (data.installed && !data.running) {
        if (titlebarPill) {
            titlebarPill.style.background = 'rgba(249,115,22,0.12)';
            titlebarPill.style.border = '1px solid rgba(249,115,22,0.3)';
            titlebarPill.style.color = '#fb923c';
            titlebarPill.innerHTML = '<span style="width:5px;height:5px;border-radius:50%;background:#f97316;"></span> Dayandırılıb';
        }
        if (installWrapper) {
            installWrapper.style.display = 'inline-flex';
            const btn = document.getElementById('pg-install-btn');
            if (btn) btn.innerHTML = '<i data-lucide="play" style="width:11px;height:11px;"></i><span>Başlat</span>';
        }
        if (createSection) createSection.style.display = 'none';
    } else {
        if (titlebarPill) {
            titlebarPill.style.background = 'rgba(239,68,68,0.12)';
            titlebarPill.style.border = '1px solid rgba(239,68,68,0.3)';
            titlebarPill.style.color = '#f87171';
            titlebarPill.innerHTML = '<span style="width:5px;height:5px;border-radius:50%;background:#ef4444;"></span> Quraşdırılmayıb';
        }
        if (installWrapper) {
            installWrapper.style.display = 'inline-flex';
            const btn = document.getElementById('pg-install-btn');
            if (btn) btn.innerHTML = '<i data-lucide="download" style="width:11px;height:11px;"></i><span>Quraşdır</span>';
        }
        if (createSection) createSection.style.display = 'none';
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

// Serverdə PostgreSQL mühərrikini quraşdırır
async function installPgEngineOnServer() {
    if (!currentPgServerId) return;

    const btn = document.getElementById('pg-install-btn');
    const oldText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Quraşdırılır (Docker + UFW)...';
    }

    try {
        const resp = await fetch(`/api/plugins/postgres/install/${currentPgServerId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: 5432 })
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(err);
        }

        const res = await resp.json();
        alert('✅ ' + (res.message || 'PostgreSQL uğurla quraşdırıldı və aktivləşdirildi!'));
        await refreshPgStatus();
    } catch (e) {
        alert('❌ Quraşdırma zamanı xəta baş verdi:\n' + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = oldText;
        }
    }
}

// İstifadəçinin xarici IP-sini avtomatik tapır
async function fetchMyIpAddress() {
    const ipInput = document.getElementById('pg-client-ip');
    if (!ipInput) return;

    try {
        const resp = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
        if (resp.ok) {
            const data = await resp.json();
            if (data.ip) {
                ipInput.value = data.ip;
                return;
            }
        }
    } catch (_) {}

    // Fallback: əgər ipify işləməzsə icanhazip
    try {
        const resp2 = await fetch('https://icanhazip.com', { signal: AbortSignal.timeout(3000) });
        if (resp2.ok) {
            const ipText = (await resp2.text()).trim();
            if (ipText) {
                ipInput.value = ipText;
            }
        }
    } catch (_) {}
}

// Yeni layihə üçün baza və connection string generasiya edir
async function generateNewPgDatabase() {
    if (!currentPgServerId) {
        alert('Zəhmət olmasa server seçin');
        return;
    }

    const nameInput = document.getElementById('pg-new-app-name');
    const btn = document.getElementById('pg-generate-btn');

    const appName = nameInput ? nameInput.value.trim() : '';

    if (!appName) {
        alert('Zəhmət olmasa layihənin adını daxil edin (məs: floorgame, ecommerce)');
        if (nameInput) nameInput.focus();
        return;
    }

    const oldBtnText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Baza və şifrə yaradılır...';
    }

    try {
        const resp = await fetch(`/api/plugins/postgres/create-db/${currentPgServerId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_name: appName
            })
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(err);
        }

        const data = await resp.json();

        // Nəticə qutusunu doldurub göstəririk
        const resBox = document.getElementById('pg-result-box');
        const connStrInput = document.getElementById('pg-result-conn-str');
        const resDb = document.getElementById('pg-res-db');
        const resUser = document.getElementById('pg-res-user');
        const resPass = document.getElementById('pg-res-pass');

        if (connStrInput) connStrInput.value = data.connection_string;
        if (resDb) resDb.textContent = data.db_name;
        if (resUser) resUser.textContent = data.db_user;
        if (resPass) resPass.textContent = data.db_password;

        if (resBox) {
            resBox.style.display = 'block';
            resBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Giriş sahəsini təmizləyirik
        if (nameInput) nameInput.value = '';

        // Bazalar cədvəlini yeniləyirik
        await loadPgDatabases(currentPgServerId);
    } catch (e) {
        alert('❌ Baza yaradılarkən xəta baş verdi:\n' + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = oldBtnText;
        }
    }
}

// Nəticə connection string-ini kopyalayır
function copyResultConnStr() {
    const input = document.getElementById('pg-result-conn-str');
    const btn = document.getElementById('pg-copy-result-btn');
    if (!input || !input.value) return;

    navigator.clipboard.writeText(input.value).then(() => {
        if (btn) {
            const old = btn.innerHTML;
            btn.innerHTML = '✓ Kopyalandı!';
            btn.style.background = '#059669';
            setTimeout(() => {
                btn.innerHTML = old;
                btn.style.background = '#10b981';
            }, 2000);
        }
    }).catch(() => {
        input.select();
        document.execCommand('copy');
    });
}

// Bu serverdəki mövcud bazaları gətirir və cədvələ doldurur
async function loadPgDatabases(serverId) {
    const tbody = document.getElementById('pg-databases-tbody');
    const countBadge = document.getElementById('pg-db-count-badge');
    if (!tbody) return;

    try {
        const resp = await fetch(`/api/plugins/postgres/list-dbs/${serverId}`);
        if (!resp.ok) throw new Error('Bazaları gətirmək mümkün olmadı');
        const list = await resp.json();

        if (countBadge) countBadge.textContent = `${list.length} baza`;

        if (!list || list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="padding: 24px; text-align: center; color: var(--text-secondary);">
                        Bu serverdə hələ heç bir layihə bazası yaradılmayıb. Yuxarıdakı form ilə dərhal yarada bilərsiniz.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = '';
        list.forEach(item => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';

            // Item-in məlumatlarını JSON olaraq saxlayırıq
            const itemJsonStr = encodeURIComponent(JSON.stringify(item));

            tr.innerHTML = `
                <td style="padding: 5px 8px; font-weight: 600; color: #fff; vertical-align: middle; white-space: nowrap;">
                    <span style="display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="database" style="width: 11px; height: 11px; color: #38bdf8;"></i>
                        <span style="font-size: 0.74rem;">${escapeHtml(item.app_name)}</span>
                    </span>
                </td>
                <td style="padding: 5px 8px; vertical-align: middle; white-space: nowrap;">
                    <span style="color: #60a5fa; font-family: monospace; font-weight: 600; font-size: 0.74rem;">${escapeHtml(item.db_name)}</span>
                    <span style="font-size: 0.68rem; color: #64748b; margin-left: 4px;">(${escapeHtml(item.db_user)})</span>
                </td>
                <td style="padding: 5px 8px; font-family: monospace; color: #94a3b8; font-size: 0.72rem; vertical-align: middle;">
                    ${item.port || 5432}
                </td>
                <td style="padding: 5px 8px; vertical-align: middle;">
                    <div style="display: flex; align-items: center; gap: 4px; width: 100%;">
                        <input type="password" 
                               value="${escapeHtml(item.connection_string)}" 
                               readonly 
                               onclick="this.select()"
                               title="Klikləyərək seçə bilərsiniz"
                               style="height: 24px; padding: 0 6px; border-radius: 4px; background: rgba(0,0,0,0.45); border: 1px solid var(--card-border); color: #38bdf8; font-size: 0.72rem; font-family: monospace; flex: 1; min-width: 260px; letter-spacing: 2px;" 
                               id="cs-${item.id}">
                        <button type="button" class="btn btn-secondary" onclick="toggleShowPassword('cs-${item.id}', this)" style="height: 24px; width: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px;" title="Göstər / Gizlə">
                            <i data-lucide="eye" style="width: 11px; height: 11px;"></i>
                        </button>
                        <button type="button" class="btn btn-primary" onclick="copyPgDbConnString('${escapeHtml(item.connection_string)}', this)" style="height: 24px; width: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: #3b82f6; border-radius: 4px;" title="Kopyala">
                            <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                        </button>
                        <button type="button" class="btn btn-secondary" onclick="openPgDbDetails('${itemJsonStr}')" style="height: 24px; width: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.06); border-radius: 4px;" title="Tam baxış və fərqli hostlar">
                            <i data-lucide="external-link" style="width: 11px; height: 11px;"></i>
                        </button>
                    </div>
                </td>
                <td style="padding: 5px 8px; text-align: right; vertical-align: middle; white-space: nowrap;">
                    <button type="button" class="btn-icon" onclick="deletePgDatabasePrompt('${serverId}', '${escapeHtml(item.db_name)}', '${escapeHtml(item.app_name)}')" style="color: #f87171; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 4px; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;" title="Bazanı sil">
                        <i data-lucide="trash-2" style="width: 11px; height: 11px;"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    } catch (e) {
        console.error('loadPgDatabases xətası:', e);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="padding: 16px; text-align: center; color: #ef4444; font-size: 0.75rem;">
                    Xəta: ${e.message}
                </td>
            </tr>
        `;
    }
}

function toggleShowPassword(inputId, btn) {
    const el = document.getElementById(inputId);
    if (!el) return;
    if (el.type === 'password') {
        el.type = 'text';
        el.style.letterSpacing = 'normal';
        btn.innerHTML = '<i data-lucide="eye-off" style="width: 11px; height: 11px;"></i>';
        btn.title = 'Gizlət (Şifrələ)';
    } else {
        el.type = 'password';
        el.style.letterSpacing = '2px';
        btn.innerHTML = '<i data-lucide="eye" style="width: 11px; height: 11px;"></i>';
        btn.title = 'Tam Göstər';
    }
    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

function copyPgDbConnString(str, btn) {
    navigator.clipboard.writeText(str).then(() => {
        const oldHtml = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="check" style="width: 11px; height: 11px;"></i>';
        btn.style.background = '#10b981';
        if (window.lucide) lucide.createIcons();
        setTimeout(() => {
            btn.innerHTML = oldHtml;
            btn.style.background = '#3b82f6';
            if (window.lucide) lucide.createIcons();
        }, 1500);
    });
}

// Baza üçün detallı baxış və host dəyişdirici (Xarici IP vs Localhost vs Docker)
function openPgDbDetails(itemJsonEncoded) {
    try {
        const item = JSON.parse(decodeURIComponent(itemJsonEncoded));
        
        let existingModal = document.getElementById('pg-db-detail-dialog');
        if (existingModal) existingModal.remove();

        // Xarici IP, localhost və docker üçün linklər hazırlayırıq
        const rawUrl = item.connection_string;
        const hostMatch = rawUrl.match(/@([^:/]+):/);
        const currentHost = hostMatch ? hostMatch[1] : '';

        const urlWithLocalhost = currentHost ? rawUrl.replace(`@${currentHost}:`, '@localhost:') : rawUrl;
        const urlWithDocker = currentHost ? rawUrl.replace(`@${currentHost}:`, '@masterdeploy-postgres:') : rawUrl;

        const dialog = document.createElement('div');
        dialog.id = 'pg-db-detail-dialog';
        dialog.className = 'modal-backdrop active';
        dialog.style.zIndex = '10005';
        dialog.innerHTML = `
            <div class="modal-card" style="max-width: 620px; width: 95%; padding: 14px 18px; animation: fadeIn 0.15s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid var(--card-border); padding-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <i data-lucide="database" style="width: 14px; height: 14px; color: #38bdf8;"></i>
                        <h3 style="margin: 0; font-size: 0.88rem; font-weight: 600; color: #fff;">${escapeHtml(item.app_name)} — Connection String</h3>
                    </div>
                    <button type="button" class="btn-icon" onclick="document.getElementById('pg-db-detail-dialog').remove()" style="border:none; background:transparent; color:#94a3b8; cursor:pointer; padding: 2px;">
                        <i data-lucide="x" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>

                <!-- Host rejimi seçimi -->
                <div style="margin-bottom: 10px;">
                    <label style="display: block; font-size: 0.72rem; color: #64748b; margin-bottom: 5px; font-weight: 600; text-transform: uppercase;">Host / Qoşulma Növü:</label>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;">
                        <button type="button" id="pg-mode-ip" class="btn btn-secondary" onclick="switchPgDetailMode('ip')" style="padding: 5px 8px; font-size: 0.73rem; border-color: #3b82f6; background: rgba(59,130,246,0.12); color: #60a5fa; font-weight: 600; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                            <i data-lucide="globe" style="width: 11px; height: 11px;"></i>
                            <span>Xarici IP (${escapeHtml(currentHost)})</span>
                        </button>
                        <button type="button" id="pg-mode-local" class="btn btn-secondary" onclick="switchPgDetailMode('local')" style="padding: 5px 8px; font-size: 0.73rem; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                            <i data-lucide="cpu" style="width: 11px; height: 11px;"></i>
                            <span>Localhost</span>
                        </button>
                        <button type="button" id="pg-mode-docker" class="btn btn-secondary" onclick="switchPgDetailMode('docker')" style="padding: 5px 8px; font-size: 0.73rem; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                            <i data-lucide="container" style="width: 11px; height: 11px;"></i>
                            <span>Docker</span>
                        </button>
                    </div>
                </div>

                <!-- Tam Connection String qutusu -->
                <div style="margin-bottom: 12px;">
                    <div style="position: relative;">
                        <textarea id="pg-detail-conn-box" readonly onclick="this.select()" rows="2" style="width: 100%; padding: 8px 10px; border-radius: 6px; background: #06090e; border: 1px solid rgba(59,130,246,0.3); color: #38bdf8; font-family: monospace; font-size: 0.75rem; resize: none; word-break: break-all; line-height: 1.4;">${escapeHtml(item.connection_string)}</textarea>
                    </div>
                    <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
                        <button type="button" class="btn btn-primary" onclick="copyPgDetailBox()" id="pg-copy-detail-btn" style="height: 26px; padding: 0 12px; background: #10b981; font-weight: 500; font-size: 0.75rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
                            <i data-lucide="copy" style="width: 11px; height: 11px;"></i>
                            <span>Kopyala</span>
                        </button>
                    </div>
                </div>

                <!-- Ayrı-ayrı parametrlər -->
                <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); border-radius: 6px; padding: 8px 12px; font-size: 0.73rem;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                        <div><span style="color: #64748b;">Host:</span> <b id="pg-detail-host" style="color: #fff; font-family: monospace;">${escapeHtml(currentHost)}</b></div>
                        <div><span style="color: #64748b;">Port:</span> <b style="color: #fff; font-family: monospace;">${item.port || 5432}</b></div>
                        <div><span style="color: #64748b;">Baza:</span> <b style="color: #fff; font-family: monospace;">${escapeHtml(item.db_name)}</b></div>
                        <div><span style="color: #64748b;">User:</span> <b style="color: #fff; font-family: monospace;">${escapeHtml(item.db_user)}</b></div>
                    </div>
                    <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.04);">
                        <span style="color: #64748b;">Password:</span> <b style="color: #34d399; font-family: monospace;">${escapeHtml(item.db_password)}</b>
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                    <button type="button" class="btn btn-secondary" onclick="document.getElementById('pg-db-detail-dialog').remove()" style="height: 26px; padding: 0 12px; font-size: 0.73rem; border-radius: 4px;">Bağla</button>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
        if (window.lucide) lucide.createIcons();

        // Rejim dəyişmə funksiyaları
        window._pgDetailUrls = {
            ip: rawUrl,
            local: urlWithLocalhost,
            docker: urlWithDocker,
            ipHost: currentHost,
        };

        window.switchPgDetailMode = function(mode) {
            const box = document.getElementById('pg-detail-conn-box');
            const hostEl = document.getElementById('pg-detail-host');
            const bIp = document.getElementById('pg-mode-ip');
            const bLocal = document.getElementById('pg-mode-local');
            const bDocker = document.getElementById('pg-mode-docker');

            [bIp, bLocal, bDocker].forEach(b => {
                if (b) {
                    b.style.borderColor = 'var(--card-border)';
                    b.style.background = 'transparent';
                    b.style.color = '#ccc';
                    b.style.fontWeight = 'normal';
                }
            });

            if (mode === 'ip') {
                if (box) box.value = window._pgDetailUrls.ip;
                if (hostEl) hostEl.textContent = window._pgDetailUrls.ipHost;
                if (bIp) { bIp.style.borderColor = '#3b82f6'; bIp.style.background = 'rgba(59,130,246,0.15)'; bIp.style.color = '#60a5fa'; bIp.style.fontWeight = '600'; }
            } else if (mode === 'local') {
                if (box) box.value = window._pgDetailUrls.local;
                if (hostEl) hostEl.textContent = 'localhost';
                if (bLocal) { bLocal.style.borderColor = '#3b82f6'; bLocal.style.background = 'rgba(59,130,246,0.15)'; bLocal.style.color = '#60a5fa'; bLocal.style.fontWeight = '600'; }
            } else if (mode === 'docker') {
                if (box) box.value = window._pgDetailUrls.docker;
                if (hostEl) hostEl.textContent = 'masterdeploy-postgres';
                if (bDocker) { bDocker.style.borderColor = '#3b82f6'; bDocker.style.background = 'rgba(59,130,246,0.15)'; bDocker.style.color = '#60a5fa'; bDocker.style.fontWeight = '600'; }
            }
        };

        window.copyPgDetailBox = function() {
            const box = document.getElementById('pg-detail-conn-box');
            const btn = document.getElementById('pg-copy-detail-btn');
            if (!box) return;
            navigator.clipboard.writeText(box.value).then(() => {
                if (btn) {
                    const old = btn.innerHTML;
                    btn.innerHTML = '✓ Kopyalandı!';
                    setTimeout(() => { btn.innerHTML = old; }, 1500);
                }
            });
        };

    } catch (err) {
        console.error('openPgDbDetails xətası:', err);
    }
}

async function deletePgDatabasePrompt(serverId, dbName, appName) {
    if (!confirm(`⚠️ DİQQƏT: '${appName}' layihəsinin '${dbName}' bazasını və onun bütün məlumatlarını tamamilə silmək istədiyinizdən əminsiniz?`)) {
        return;
    }

    try {
        const resp = await fetch(`/api/plugins/postgres/delete-db/${serverId}/${dbName}`, {
            method: 'DELETE'
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(err);
        }

        alert(`✅ '${dbName}' bazası uğurla silindi.`);
        await loadPgDatabases(serverId);
    } catch (e) {
        alert('❌ Baza silinərkən xəta: ' + e.message);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
