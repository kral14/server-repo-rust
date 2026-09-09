// --- Help Center & System Update ---
async function fetchChangelog() {
    try {
        const res = await fetch('/api/system/changelog');
        return await res.json();
    } catch (e) { return []; }
}

async function fetchDocs() {
    try {
        const res = await fetch('/api/system/docs');
        return await res.json();
    } catch (e) { return {}; }
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
    try {
        const changelog = await fetchChangelog();
        if (changelog && Array.isArray(changelog) && changelog.length > 0) {
            systemVersions = changelog;
        }

        const vRes = await fetch('/api/version');
        const vData = await vRes.json();
        _currentPanelVersion = vData.version;
        const currentNum = parseVersionNum(_currentPanelVersion);

        let latestVer = '';
        let hasNewer = false;
        if (systemVersions.length > 0) {
            latestVer = systemVersions[0].version;
            if (parseVersionNum(latestVer) > currentNum) {
                hasNewer = true;
            }
        }

        // Badge məntiqi — yalnız burada, fetchAppVersion-da deyil
        const badge = document.getElementById('version-badge');
        if (badge) {
            if (hasNewer) {
                badge.innerHTML = `<span onclick="openSystemUpdateModal()" style="background: linear-gradient(135deg, #ff416c, #ff4b2b); color: white; border-radius: 5px; padding: 2px 7px; font-size: 0.52rem; margin-left: 4px; cursor: pointer; font-weight: 700; letter-spacing: 0.5px; box-shadow: 0 2px 8px rgba(255,65,108,0.4); animation: pulse-badge 2s infinite;" title="${latestVer} mövcuddur — klikləyin">UPDATE</span>`;
            } else {
                badge.innerHTML = '';
            }
        }

        // Əgər pəncərə açıqdırsa, dərhal kartları göstər!
        const modal = document.getElementById('system-update-modal');
        if (modal && modal.style.display !== 'none' && !modal.classList.contains('minimized')) {
            renderVersionCards();
        }
    } catch (e) { }
}

async function openSystemUpdateModal() {
    showModal('system-update-modal');
    if (systemVersions && systemVersions.length > 0) {
        renderVersionCards();
    } else {
        const container = document.getElementById('version-cards-list');
        if (container) {
            container.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-secondary);"><span style="display:inline-block; animation:spin 1s linear infinite; margin-right:8px;">⏳</span> Versiyalar yoxlanılır...</div>';
        }
    }
    await initSystemUpdates();
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

        // Tarix badge
        const dateBadge = v.date
            ? `<span style="font-size: 0.72rem; color: #94a3b8; background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid rgba(255,255,255,0.08);">📅 ${v.date}</span>`
            : '';

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
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="font-weight: 700; font-size: 1rem; color: var(--text-primary); font-family: monospace;">${v.version}</span>
                    ${badgeHtml}
                    ${dateBadge}
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
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ version: version })
                });

                if (res.ok) {
                    // Pull və proses uğurludur, loading ekranını açırıq
                    showVersionSwitchProgress(version);
                } else {
                    const errMsg = await res.text();
                    showInfoCard('❌ Keçid Baş tutmadı', 'Docker Pull Xətası', errMsg);
                }
            } catch (e) {
                // Şəbəkə kəsilməsi (fetch-in yarıda qalması) serverin sönməsi deməkdir.
                // Buna görə əgər xəta baş verərsə lakin heç bir HTTP statusu yoxdursa, böyük ehtimal update başlayıb.
                // Ancaq ehtiyat üçün 3 saniyə gözləyib yenidən yoxlama loadingini göstərə bilərik.
                showVersionSwitchProgress(version);
            }
        }
    });
}

function showVersionSwitchProgress(targetVersion) {
    let cleanTargetVersion = targetVersion || '';
    if (cleanTargetVersion.startsWith('v')) {
        cleanTargetVersion = cleanTargetVersion.substring(1);
    }

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
            <p id="update-countdown" style="color:var(--text-secondary); font-size:0.8rem; margin-top:1.2rem; font-family:monospace;">12 saniyə...</p>
        </div>
    `;
    document.body.appendChild(overlay);

    let secs = 12;
    const interval = setInterval(() => {
        secs--;
        const pct = Math.min(((12 - secs) / 12) * 90, 90);
        const bar = document.getElementById('progress-bar');
        const cd = document.getElementById('update-countdown');
        if (bar) bar.style.width = pct + '%';
        if (cd) cd.textContent = secs > 0 ? `${secs} saniyə...` : 'Serverə yenidən bağlanılır...';
        if (secs <= 0) {
            clearInterval(interval);
            pollNewVersion(cleanTargetVersion);
        }
    }, 1000);
}

async function pollNewVersion(targetVersion) {
    const cd = document.getElementById('update-countdown');
    const bar = document.getElementById('progress-bar');
    let attempts = 0;
    
    const pollInterval = setInterval(async () => {
        attempts++;
        if (cd) cd.textContent = `Yoxlanış cəhdi ${attempts} (Yeni versiya gözlənilir)...`;
        
        try {
            const res = await fetch('/api/version?t=' + Date.now());
            if (res.ok) {
                const data = await res.json();
                const currentVer = data.version || '';
                if (currentVer.includes(targetVersion) || attempts > 15) {
                    if (bar) bar.style.width = '100%';
                    if (cd) cd.textContent = 'Yeni versiya aktivdir! Səhifə yenilənir...';
                    clearInterval(pollInterval);
                    setTimeout(() => {
                        window.location.href = window.location.pathname + '?t=' + Date.now();
                    }, 800);
                }
            }
        } catch (e) {
            console.log("Server is offline during update restart...");
        }
    }, 2000);
}

// Köhnə funksiyalar — uyğunluq üçün saxlanılır
async function quickUpdate(version) {
    await confirmVersionSwitch(version, false);
}
async function confirmSystemUpdate() {
    const select = document.getElementById('system-version-select');
    if (select) await confirmVersionSwitch(select.value, false);
}
function updateSelectedVersionChanges() { }

// ─── Custom Kart Modal (confirm / alert yerinə) ───────────────────────────────────
function showConfirmCard(opts) {
    if (typeof showConfirmModal === 'function') {
        return showConfirmModal(opts);
    }
}

function showInfoCard(title, subtitle, body) {
    if (typeof showAlertModal === 'function') {
        return showAlertModal({ title, subtitle, message: body });
    }
}

// ─── Fəaliyyət Jurnalı & Canlı Debug Monitoru ──────────────────────────────
const LOG_ICONS = {
    deploy: { icon: '<i data-lucide="zap" style="width:16px;height:16px;color:#00d2ff;"></i>', color: '#00d2ff', tagClass: 'term-tag-deploy', label: 'Deploy' },
    update: { icon: '<i data-lucide="refresh-cw" style="width:16px;height:16px;color:#7c3aed;"></i>', color: '#7c3aed', tagClass: 'term-tag-info', label: 'Yenilənmə' },
    server: { icon: '<i data-lucide="server" style="width:16px;height:16px;color:#00e676;"></i>', color: '#00e676', tagClass: 'term-tag-info', label: 'Server' },
    app: { icon: '<i data-lucide="box" style="width:16px;height:16px;color:#ff9800;"></i>', color: '#ff9800', tagClass: 'term-tag-info', label: 'Layihə' },
    error: { icon: '<i data-lucide="alert-circle" style="width:16px;height:16px;color:#ff1744;"></i>', color: '#ff1744', tagClass: 'term-tag-error', label: 'Xəta' },
    warning: { icon: '<i data-lucide="alert-triangle" style="width:16px;height:16px;color:#ffb86c;"></i>', color: '#ffb86c', tagClass: 'term-tag-warning', label: 'Xəbərdarlıq' },
    success: { icon: '<i data-lucide="check-circle-2" style="width:16px;height:16px;color:#00e676;"></i>', color: '#00e676', tagClass: 'term-tag-success', label: 'Uğurlu' },
    info: { icon: '<i data-lucide="info" style="width:16px;height:16px;color:#38bdf8;"></i>', color: '#9aa0a6', tagClass: 'term-tag-info', label: 'Məlumat' },
    delete: { icon: '<i data-lucide="trash-2" style="width:16px;height:16px;color:#ff1744;"></i>', color: '#ff1744', tagClass: 'term-tag-error', label: 'Silinmə' },
    setup: { icon: '<i data-lucide="settings" style="width:16px;height:16px;color:#00e676;"></i>', color: '#00e676', tagClass: 'term-tag-success', label: 'Qurulum' },
    tunnels: { icon: '<i data-lucide="cloud" style="width:16px;height:16px;color:#38bdf8;"></i>', color: '#38bdf8', tagClass: 'term-tag-info', label: 'Tünel' },
};

let activityLogsState = {
    allLogs: [],
    filteredLogs: [],
    levelFilter: 'all',
    moduleFilter: 'all',
    projectFilter: 'all',
    searchQuery: '',
    isStreaming: true,
    viewMode: 'cards', // 'cards' | 'terminal'
    autoScroll: true,
    pollInterval: null,
    lastHash: '',
    isFetching: false
};
