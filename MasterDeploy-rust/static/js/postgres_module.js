// PostgreSQL Database Manager Frontend Module

let currentPgServerId = null;
let currentPgStatus = null;

// Modalı açır və ilkin məlumatları yükləyir
async function openPostgresModal(preferredServerId = null) {
    showModal('postgres-modal');
    await loadPgServers(preferredServerId);
    fetchMyIpAddress();
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
    const dot = document.getElementById('pg-status-dot');
    const title = document.getElementById('pg-status-title');
    const sub = document.getElementById('pg-status-sub');
    const installWrapper = document.getElementById('pg-install-action-wrapper');
    const createSection = document.getElementById('pg-create-section');

    if (data.not_found) {
        if (dot) dot.style.background = '#ef4444';
        if (title) title.textContent = 'Server Mövcud Deyil';
        if (sub) sub.textContent = 'Zəhmət olmasa əvvəlcə server əlavə edin.';
        return;
    }

    if (data.running) {
        if (dot) dot.style.background = '#10b981';
        if (title) title.innerHTML = '<span style="color: #34d399;">● Aktiv & İşləkdir</span> (PostgreSQL 16-alpine)';
        if (sub) sub.textContent = `Docker Konteyner: ${data.container_name} | Port: ${data.port} | Qovluq: ${data.data_dir}`;
        if (installWrapper) installWrapper.style.display = 'none';
        if (createSection) createSection.style.display = 'block';
    } else if (data.installed && !data.running) {
        if (dot) dot.style.background = '#f97316';
        if (title) title.textContent = 'Konteyner Dayandırılıb';
        if (sub) sub.textContent = 'PostgreSQL konteyneri mövcuddur, lakin hazırda işləmir.';
        if (installWrapper) {
            installWrapper.style.display = 'block';
            const btn = document.getElementById('pg-install-btn');
            if (btn) btn.textContent = '▶️ Konteyneri Yenidən Başlat';
        }
        if (createSection) createSection.style.display = 'none';
    } else {
        if (dot) dot.style.background = '#ef4444';
        if (title) title.textContent = 'PostgreSQL Quraşdırılmayıb';
        if (sub) sub.textContent = 'Bu serverdə hələ PostgreSQL mühərriki yoxdur. Aşağıdakı düymə ilə tək kliklə quraşdıra bilərsiniz.';
        if (installWrapper) {
            installWrapper.style.display = 'block';
            const btn = document.getElementById('pg-install-btn');
            if (btn) btn.textContent = '🛠️ Serverdə PostgreSQL Quraşdır (Port: 5432)';
        }
        if (createSection) createSection.style.display = 'none';
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
            tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

            tr.innerHTML = `
                <td style="padding: 10px 14px; font-weight: 600; color: #fff;">
                    🚀 ${escapeHtml(item.app_name)}
                </td>
                <td style="padding: 10px 14px;">
                    <span style="color: #60a5fa; font-family: monospace;">${escapeHtml(item.db_name)}</span><br>
                    <span style="font-size: 0.75rem; color: var(--text-secondary);">İstifadəçi: ${escapeHtml(item.db_user)}</span>
                </td>
                <td style="padding: 10px 14px; font-family: monospace; color: #ccc;">
                    ${item.port || 5432}
                </td>
                <td style="padding: 10px 14px;">
                    <div style="display: flex; align-items: center; gap: 6px; max-width: 320px;">
                        <input type="password" value="${escapeHtml(item.connection_string)}" readonly style="padding: 4px 8px; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); color: #38bdf8; font-size: 0.78rem; font-family: monospace; flex: 1;" id="cs-${item.id}">
                        <button type="button" class="btn btn-secondary" onclick="toggleShowPassword('cs-${item.id}', this)" style="padding: 4px 8px; font-size: 0.75rem;" title="Göstər / Gizlə">👁️</button>
                        <button type="button" class="btn btn-primary" onclick="copyPgDbConnString('${escapeHtml(item.connection_string)}', this)" style="padding: 4px 8px; font-size: 0.75rem; background: #3b82f6;" title="Kopyala">📋</button>
                    </div>
                </td>
                <td style="padding: 10px 14px; text-align: right;">
                    <button type="button" class="btn-icon" onclick="deletePgDatabasePrompt('${serverId}', '${escapeHtml(item.db_name)}', '${escapeHtml(item.app_name)}')" style="color: #ef4444; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 6px; padding: 4px 8px; cursor: pointer;" title="Baza və istifadəçini sil">
                        🗑️ Sil
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('loadPgDatabases xətası:', e);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="padding: 20px; text-align: center; color: #ef4444;">
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
        btn.textContent = '🔒';
    } else {
        el.type = 'password';
        btn.textContent = '👁️';
    }
}

function copyPgDbConnString(str, btn) {
    navigator.clipboard.writeText(str).then(() => {
        const old = btn.textContent;
        btn.textContent = '✓';
        btn.style.background = '#10b981';
        setTimeout(() => {
            btn.textContent = old;
            btn.style.background = '#3b82f6';
        }, 1500);
    });
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
