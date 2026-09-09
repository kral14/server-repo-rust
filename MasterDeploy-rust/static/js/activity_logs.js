async function addActivityLog(message, type = 'info', module = null) {
    try {
        await fetch('/api/activity-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, log_type: type, module: module })
        });
        if (activityLogsState.isStreaming) {
            fetchAndRenderActivityLogs();
        }
    } catch (e) {
        console.error("Failed to add activity log", e);
    }
}

function resolveLogLevel(log) {
    const t = (log.log_type || '').toLowerCase();
    const m = (log.message || '').toLowerCase();
    if (t === 'error' || t === 'delete' || m.includes('xəta') || m.includes('uğursuz') || m.includes('fail')) return 'error';
    if (t === 'warning' || m.includes('dayandırıldı') || m.includes('ləğv') || m.includes('warning')) return 'warning';
    if (t === 'success' || t === 'setup' || m.includes('uğurla') || m.includes('hazırlandı') || m.includes('yaradıldı')) return 'success';
    if (t === 'deploy' || m.includes('deploy') || m.includes('yayım')) return 'deploy';
    return 'info';
}

function resolveLogModule(log) {
    if (log.module) {
        const mod = log.module.toLowerCase();
        if (mod.includes('tunnel') || mod.includes('tünel')) return 'tunnels';
        if (mod.includes('app') || mod.includes('layihə')) return 'apps';
        if (mod.includes('server')) return 'servers';
        if (mod.includes('deploy')) return 'deploy';
        if (mod.includes('system') || mod.includes('sistem')) return 'system';
    }
    const m = (log.message || '').toLowerCase();
    if (m.includes('tünel') || m.includes('tunnel') || m.includes('trycloudflare') || m.includes('keçid')) return 'tunnels';
    if (m.includes('server') || m.includes('ssh') || m.includes('host')) return 'servers';
    if (m.includes('deploy') || m.includes('yayım') || m.includes('build') || m.includes('qurulum')) return 'deploy';
    if (m.includes('masterdeploy') || m.includes('sistem') || m.includes('update') || m.includes('token')) return 'system';
    return 'apps';
}

function startLiveActivityMonitor() {
    activityLogsState.isStreaming = true;
    updateStreamBadgeUI();
    fetchAndRenderActivityLogs();
    if (activityLogsState.pollInterval) clearInterval(activityLogsState.pollInterval);
    activityLogsState.pollInterval = setInterval(() => {
        if (activityLogsState.isStreaming) {
            fetchAndRenderActivityLogs();
        }
    }, 1500);
}

function stopLiveActivityMonitor() {
    if (activityLogsState.pollInterval) {
        clearInterval(activityLogsState.pollInterval);
        activityLogsState.pollInterval = null;
    }
}

function toggleActivityStream() {
    activityLogsState.isStreaming = !activityLogsState.isStreaming;
    updateStreamBadgeUI();
    if (activityLogsState.isStreaming) {
        fetchAndRenderActivityLogs();
    }
}

function updateStreamBadgeUI() {
    const badge = document.getElementById('activity-live-badge');
    const toggleBtn = document.getElementById('btn-activity-stream-toggle');
    const toggleIcon = document.getElementById('stream-toggle-icon');
    const toggleText = document.getElementById('stream-toggle-text');

    if (activityLogsState.isStreaming) {
        if (badge) {
            badge.classList.remove('paused');
            badge.innerHTML = '<span class="pulse-dot"></span> CANLI YAYIM';
        }
        if (toggleIcon) toggleIcon.textContent = '⏸️';
        if (toggleText) toggleText.textContent = 'Dondur';
    } else {
        if (badge) {
            badge.classList.add('paused');
            badge.innerHTML = '<span class="pulse-dot"></span> DAYANDIRILDI';
        }
        if (toggleIcon) toggleIcon.textContent = '▶️';
        if (toggleText) toggleText.textContent = 'Davam Et';
    }
}

function setActivityViewMode(mode) {
    activityLogsState.viewMode = mode;
    const cardsView = document.getElementById('activity-cards-view');
    const termView = document.getElementById('activity-terminal-view');
    const btnCards = document.getElementById('btn-view-cards');
    const btnTerm = document.getElementById('btn-view-terminal');

    if (mode === 'terminal') {
        if (cardsView) cardsView.style.display = 'none';
        if (termView) termView.style.display = 'flex';
        if (btnCards) btnCards.classList.remove('active');
        if (btnTerm) btnTerm.classList.add('active');
    } else {
        if (cardsView) cardsView.style.display = 'flex';
        if (termView) termView.style.display = 'none';
        if (btnCards) btnCards.classList.add('active');
        if (btnTerm) btnTerm.classList.remove('active');
    }
    renderActivityLogsDOM();
}

function setActivityFilter(type, val) {
    if (type === 'level') {
        activityLogsState.levelFilter = val;
    } else if (type === 'module') {
        activityLogsState.moduleFilter = val;
    }
    // Update active pill classes
    document.querySelectorAll(`.activity-filter-pill[data-filter-type="${type}"]`).forEach(el => {
        if (el.getAttribute('data-filter-val') === val) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
    filterAndRenderActivityLogs();
}

function handleActivityProjectFilter() {
    const sel = document.getElementById('activity-project-filter');
    activityLogsState.projectFilter = sel ? sel.value : 'all';
    filterAndRenderActivityLogs();
}

function populateActivityProjectFilter(logs) {
    const sel = document.getElementById('activity-project-filter');
    if (!sel) return;

    const currentVal = sel.value || activityLogsState.projectFilter || 'all';
    const projectNames = new Set();

    // 1. API-dən bütün qeydiyyatda olan layihələri əlavə et
    if (window._cachedAppList && Array.isArray(window._cachedAppList)) {
        window._cachedAppList.forEach(a => {
            if (a.name) projectNames.add(a.name);
        });
    } else if (!window._isFetchingApps) {
        window._isFetchingApps = true;
        fetch('/api/applications').then(r => r.json()).then(apps => {
            window._cachedAppList = apps || [];
            window._isFetchingApps = false;
            populateActivityProjectFilter(activityLogsState.allLogs);
        }).catch(() => { window._isFetchingApps = false; });
    }

    // 2. Loqlardan layihə adlarını çıxar
    if (Array.isArray(logs)) {
        logs.forEach(l => {
            const match = l.message ? l.message.match(/'([^']+)'/) : null;
            if (match && match[1] && !match[1].includes(' ') && match[1].length < 35) {
                projectNames.add(match[1]);
            }
            if (l.target_id && l.target_id.length < 35 && !l.target_id.includes(' ')) {
                projectNames.add(l.target_id);
            }
        });
    }

    // 3. DOM-da hazır olan layihə adlarını çıxar
    document.querySelectorAll('.tunnel-app-row, [data-app-name], .app-card').forEach(el => {
        const name = el.querySelector('strong')?.textContent?.trim() || el.getAttribute('data-app-name');
        if (name && name.length < 35) projectNames.add(name);
    });

    const sortedNames = Array.from(projectNames).sort();
    let optionsHtml = '<option value="all">🚀 Bütün Layihələr</option>';
    sortedNames.forEach(pName => {
        optionsHtml += `<option value="${escapeHtml(pName)}">📦 ${escapeHtml(pName)}</option>`;
    });

    // Əgər dəyişiklik varsa DOM-u yenilə
    if (sel.options.length !== sortedNames.length + 1) {
        sel.innerHTML = optionsHtml;
        if (currentVal && (currentVal === 'all' || projectNames.has(currentVal))) {
            sel.value = currentVal;
        }
    }
}

function handleActivitySearch() {
    const input = document.getElementById('activity-search-input');
    activityLogsState.searchQuery = input ? input.value.trim().toLowerCase() : '';
    filterAndRenderActivityLogs();
}

function toggleActivityAutoScroll() {
    activityLogsState.autoScroll = !activityLogsState.autoScroll;
    const txt = document.getElementById('autoscroll-text');
    if (txt) {
        txt.textContent = activityLogsState.autoScroll ? 'Avto-Scroll: Açıq' : 'Avto-Scroll: Bağlı';
    }
}

async function fetchAndRenderActivityLogs() {
    if (activityLogsState.isFetching) return;
    activityLogsState.isFetching = true;
    try {
        const res = await fetch('/api/activity-logs');
        if (res.ok) {
            const logs = await res.json();
            const hash = JSON.stringify(logs.slice(0, 5));
            activityLogsState.allLogs = logs;

            // Layihə seçim dropdown-unu doldur
            populateActivityProjectFilter(logs);

            // Update KPI badges
            updateActivityKPIs(logs);

            // Update timestamp
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            const timeEl = document.getElementById('activity-last-update-time');
            if (timeEl) timeEl.textContent = `Yeniləndi: ${timeStr}`;

            if (hash !== activityLogsState.lastHash) {
                activityLogsState.lastHash = hash;
                filterAndRenderActivityLogs();
            }
        }
    } catch (e) {
        console.error("Fəaliyyət loqları çəkilərkən xəta", e);
    } finally {
        activityLogsState.isFetching = false;
    }
}

function updateActivityKPIs(logs) {
    const totalEl = document.getElementById('stat-total-logs');
    const errEl = document.getElementById('stat-error-logs');
    const warnEl = document.getElementById('stat-warn-logs');
    const succEl = document.getElementById('stat-success-logs');

    if (!totalEl) return;

    let total = logs.length;
    let errors = 0;
    let warnings = 0;
    let successes = 0;

    logs.forEach(l => {
        const lvl = resolveLogLevel(l);
        if (lvl === 'error') errors++;
        else if (lvl === 'warning') warnings++;
        else if (lvl === 'success' || lvl === 'deploy') successes++;
    });

    totalEl.textContent = total;
    if (errEl) errEl.textContent = errors;
    if (warnEl) warnEl.textContent = warnings;
    if (succEl) succEl.textContent = successes;
}

function filterAndRenderActivityLogs() {
    const { allLogs, levelFilter, moduleFilter, projectFilter, searchQuery } = activityLogsState;

    activityLogsState.filteredLogs = allLogs.filter(log => {
        const lvl = resolveLogLevel(log);
        const mod = resolveLogModule(log);

        if (levelFilter !== 'all' && lvl !== levelFilter) return false;
        if (moduleFilter !== 'all' && mod !== moduleFilter) return false;

        // Layihə süzgəci
        if (projectFilter && projectFilter !== 'all') {
            const pLower = projectFilter.toLowerCase();
            const msgLower = (log.message || '').toLowerCase();
            const targetLower = (log.target_id || '').toLowerCase();
            const matchesProject = msgLower.includes(`'${pLower}'`) || msgLower.includes(pLower) || targetLower === pLower;
            if (!matchesProject) return false;
        }

        if (searchQuery) {
            const haystack = `${log.message} ${log.module || ''} ${log.operator_name || ''} ${lvl} ${mod}`.toLowerCase();
            if (!haystack.includes(searchQuery)) return false;
        }

        return true;
    });

    renderActivityLogsDOM();
}

function renderActivityLogsDOM() {
    const { filteredLogs, viewMode, autoScroll } = activityLogsState;

    if (viewMode === 'terminal') {
        const termView = document.getElementById('activity-terminal-view');
        if (!termView) return;

        if (filteredLogs.length === 0) {
            termView.innerHTML = '<div style="color: #8b949e; padding: 20px; text-align: center;">// Seçilmiş filtrlərə uyğun heç bir fəaliyyət loqu tapılmadı.</div>';
            return;
        }

        termView.innerHTML = filteredLogs.map((l, i) => {
            const lvl = resolveLogLevel(l);
            const mod = resolveLogModule(l).toUpperCase();
            const tagClass = (LOG_ICONS[lvl] || LOG_ICONS.info).tagClass;
            let timeStr = '--:--:--';
            if (l.created_at) {
                const parts = l.created_at.split(' ');
                timeStr = parts[1] || parts[0];
            }
            return `<div class="activity-terminal-line" onclick="showLogDetailsByIndex(${i})" style="cursor: pointer;">
                <span class="term-time">[${timeStr}]</span>
                <span class="term-tag ${tagClass}">${lvl.toUpperCase()}</span>
                <span style="color: #79c0ff; font-weight: 600; font-size: 0.72rem;">[${mod}]</span>
                <span style="flex: 1; color: ${lvl === 'error' ? '#ff7b72' : (lvl === 'warning' ? '#d29922' : '#c9d1d9')};">${escapeHtml(l.message)}</span>
            </div>`;
        }).join('');

        if (autoScroll) {
            termView.scrollTop = termView.scrollHeight;
        }
    } else {
        const cardsView = document.getElementById('activity-cards-view');
        if (!cardsView) return;

        if (filteredLogs.length === 0) {
            cardsView.innerHTML = '<div style="font-size: 0.82rem; color: var(--text-secondary); text-align: center; padding: 30px; opacity: 0.6;">🔍 Seçilmiş meyarlara uyğun heç bir hadisə qeydə alınmayıb</div>';
            return;
        }

        cardsView.innerHTML = filteredLogs.map((l, i) => {
            const lvl = resolveLogLevel(l);
            const mod = resolveLogModule(l);
            const meta = LOG_ICONS[lvl] || LOG_ICONS.info;
            let timeStr = '--:--';
            if (l.created_at) {
                try {
                    const isoStr = l.created_at.trim().replace(" ", "T") + "Z";
                    const localDate = new Date(isoStr);
                    const h = String(localDate.getHours()).padStart(2, '0');
                    const m = String(localDate.getMinutes()).padStart(2, '0');
                    const s = String(localDate.getSeconds()).padStart(2, '0');
                    timeStr = `${h}:${m}:${s}`;
                } catch (e) {
                    timeStr = l.created_at;
                }
            }
            const escapedMessage = escapeHtml(l.message);
            const borderAccent = lvl === 'error' ? 'border-left: 3px solid #ff5252;' : (lvl === 'warning' ? 'border-left: 3px solid #ffb86c;' : (lvl === 'success' ? 'border-left: 3px solid #69f0ae;' : ''));

            return `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:8px; background:rgba(255,255,255,0.02); border: 1px solid var(--card-border); ${borderAccent}; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
                <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1; cursor:pointer;" onclick="showLogDetailsByIndex(${i})">
                    <span style="font-size:1.1rem; flex-shrink:0; display:flex; align-items:center; justify-content:center; width:30px; height:30px; background:rgba(255,255,255,0.04); border-radius:8px;">${meta.icon}</span>
                    <div style="flex:1; min-width:0;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                            <span style="font-size: 0.68rem; font-weight: 700; text-transform: uppercase; color: ${meta.color};">${meta.label || lvl}</span>
                            <span style="font-size: 0.68rem; color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 1px 5px; border-radius: 4px;">${mod.toUpperCase()}</span>
                        </div>
                        <div style="font-size:0.83rem; color:var(--text-primary); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapedMessage}">${escapedMessage}</div>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                    <button onclick="copySingleLog(event, '${escapedMessage}')" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; font-size:0.95rem; padding:4px 6px; border-radius:4px; transition:color 0.2s; display:inline-flex; align-items:center;" onmouseover="this.style.color='var(--accent-color)'" onmouseout="this.style.color='var(--text-secondary)'" title="Kopyala">
                        <i data-lucide="copy" style="width: 13px; height: 13px;"></i>
                    </button>
                    <span style="font-size:0.75rem; color:var(--text-secondary); font-family:monospace; opacity:0.85;">${timeStr}</span>
                </div>
            </div>`;
        }).join('');

        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }

        if (autoScroll) {
            cardsView.scrollTop = 0; // top is newest in cards view
        }
    }
}

// Backward compatibility helper
function renderActivityLogs() {
    fetchAndRenderActivityLogs();
}

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
        } catch (err) {
            console.error('Fallback copy failed', err);
        }
        document.body.removeChild(textarea);
        return Promise.resolve();
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function copySingleLog(event, text) {
    if (event) event.stopPropagation();
    copyToClipboard(text);
    showInfoCard('Kopyalandı', '', 'Loq uğurla buferə kopyalandı.');
}

async function copyCurrentSectionLogs() {
    const logsToCopy = activityLogsState.filteredLogs.length > 0 ? activityLogsState.filteredLogs : activityLogsState.allLogs;
    if (logsToCopy.length === 0) {
        showInfoCard('Boşdur', '', 'Kopyalanacaq loq tapılmadı.');
        return;
    }
    const textToCopy = logsToCopy.map(l => {
        const lvl = resolveLogLevel(l).toUpperCase();
        const mod = resolveLogModule(l).toUpperCase();
        return `[${l.created_at}] [${lvl}] [${mod}] ${l.message}`;
    }).join('\n');

    copyToClipboard(textToCopy);
    showInfoCard('Kopyalandı', '', `${logsToCopy.length} ədəd loq buferə kopyalandı.`);
}

function showLogDetailsByIndex(index) {
    const l = activityLogsState.filteredLogs[index] || activityLogsState.allLogs[index];
    if (!l) return;
    showLogDetails(l.message, l.log_type, l.created_at);
}

function showLogDetails(message, logType, createdAt) {
    const meta = document.getElementById('log-detail-meta');
    const text = document.getElementById('log-detail-text');
    const extraSection = document.getElementById('log-detail-extra-section');
    const extraTerminal = document.getElementById('log-detail-extra-terminal');
    const viewDeployBtn = document.getElementById('log-detail-view-deploy-btn');
    
    if (meta) meta.textContent = `${(logType || 'INFO').toUpperCase()} | ${createdAt || ''}`;
    if (text) text.value = message;
    
    if (extraSection) extraSection.style.display = 'none';
    if (viewDeployBtn) viewDeployBtn.style.display = 'none';
    
    const appMatch = message.match(/'([^']+)'/);
    let appName = null;
    let foundApp = null;
    if (appMatch) {
        appName = appMatch[1];
        if (Array.isArray(globalApps)) {
            foundApp = globalApps.find(a => a.name === appName);
        }
    }
    
    if (appName && deletionLogsCache[appName] && extraSection && extraTerminal) {
        extraSection.style.display = 'flex';
        document.getElementById('log-detail-extra-title').textContent = 'Silinmə Prosesi Loqları:';
        extraTerminal.textContent = deletionLogsCache[appName].join('\n');
    }
    
    if (foundApp && viewDeployBtn && (message.toLowerCase().includes('yenilənmə') || message.toLowerCase().includes('deploy') || message.toLowerCase().includes('manifest') || message.toLowerCase().includes('commit') || message.toLowerCase().includes('xətası'))) {
        viewDeployBtn.style.display = 'inline-block';
        viewDeployBtn.onclick = () => {
            closeModal('log-detail-modal');
            closeModal('activity-log-modal');
            viewLogs(foundApp.id);
        };
    }
    
    showModal('log-detail-modal');
}

function copyLogDetailText() {
    const text = document.getElementById('log-detail-text').value;
    copyToClipboard(text);
    showInfoCard('Kopyalandı', '', 'Uğurla buferə kopyalandı.');
}

async function clearActivityLogs() {
    try {
        const res = await fetch('/api/activity-logs', { method: 'DELETE' });
        if (res.ok) {
            activityLogsState.allLogs = [];
            activityLogsState.filteredLogs = [];
            activityLogsState.lastHash = '';
            fetchAndRenderActivityLogs();
            showInfoCard('Təmizləndi', '', 'Fəaliyyət jurnalı uğurla təmizləndi.');
        }
    } catch (e) {
        console.error("Failed to clear activity logs", e);
    }
}
