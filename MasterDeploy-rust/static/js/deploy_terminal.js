async function deployApp(id, noCache = true) {
    try {
        stopLogPolling();
        const terminal = document.getElementById('terminal-body');
        if (terminal) terminal.innerHTML = '<span style="color: #00d2ff; font-weight: 500;">🚀 Yeni yayım başladılır, zəhmət olmasa gözləyin...</span>\n';
        
        // Reset all stages immediately
        document.querySelectorAll('.stage-item').forEach(el => {
            el.style.opacity = '0.4';
            el.style.color = 'var(--text-secondary)';
            const iconEl = el.querySelector('.stage-icon');
            if (iconEl) iconEl.innerHTML = '⚪';
            const timeEl = el.querySelector('.stage-time');
            if (timeEl) timeEl.innerText = '--';
            const descEl = el.querySelector('.stage-desc');
            if (descEl) descEl.innerText = 'Gözlənilir';
        });
        const statusDot = document.getElementById('stream-status-dot');
        if (statusDot) {
            statusDot.innerText = 'Başladılır... 🔄';
            statusDot.style.color = '#00d2ff';
        }

        switchTab('app-details');
        switchAppTab('logs');

        const appName = document.getElementById('detail-app-name') ? document.getElementById('detail-app-name').innerText : id;
        const url = noCache ? `/api/deploy/${id}?no_cache=true` : `/api/deploy/${id}`;
        const res = await fetch(url, { method: 'POST' });
        if (res.ok) {
            const deployment = await res.json();
            addActivityLog(`Deploy başladıldı: ${appName}`, 'deploy');
            loadApplications();
            viewLogs(id, true, deployment.id);
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
function viewLogs(appId, switchMainTab = true, specificDeployId = null) {
    if (switchMainTab) { switchTab('app-details'); switchAppTab('logs'); }

    const terminal = document.getElementById('terminal-body');
    terminal.innerText = 'Yayım loqları yüklənir...';
    document.getElementById('cancel-deploy-btn').style.display = 'none';
    document.getElementById('stuck-warning-banner').style.display = 'none';
    document.getElementById('last-update-badge').innerText = '';
    document.getElementById('stream-status-dot').innerText = 'Loqlar yüklənir...';
    document.getElementById('stream-status-dot').style.color = '#ccc';
    currentActiveDeploymentId = specificDeployId || null;
    currentAppId = appId;
    lastUpdateTime = Date.now();
    lastSeenLog = '';
    
    // Reset global deployment timing variables
    currentDeploymentCreatedAt = null;
    currentDeploymentStatus = null;

    // Reset all stages to pending on start
    document.querySelectorAll('.stage-item').forEach(el => {
        el.style.opacity = '0.4';
        el.style.color = 'var(--text-secondary)';
        el.querySelector('.stage-icon').innerHTML = '⚪';
        el.querySelector('.stage-time').innerText = '--';
    });

    // Default to showing Build content tab
    switchLogPanel('build');

    stopLogPolling();
    stopRuntimeLogPolling();

    // Ticker to update "Last update: Xs ago" badge every second
    startUpdateBadgeTimer();

    // Əgər spesifik bir deployment ID-si verilməyibsə, ən sonuncunu tapmaq üçün sorğu atırıq
    async function initLogs() {
        if (!currentActiveDeploymentId) {
            try {
                const res = await fetch(`/api/deployments/${appId}`);
                if (res.ok) {
                    const deployments = await res.json();
                    if (deployments && deployments.length > 0) {
                        currentActiveDeploymentId = deployments[0].id;
                    }
                }
            } catch (e) {
                console.error("Error fetching deployments list", e);
            }
        }
        
        if (!currentActiveDeploymentId) {
            terminal.innerText = "[MƏLUMAT] Bu layihə üçün hələ heç bir yayım (deploy) edilməyib.";
            const statusDot = document.getElementById('stream-status-dot');
            if (statusDot) statusDot.innerText = 'Yayım yoxdur';
            return;
        }

        // Poll logs every 1 second
        logInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/deployments/single/${currentActiveDeploymentId}`);
                if (!res.ok) {
                    // Əgər tapılmırsa polling-i dayandırırıq
                    stopLogPolling();
                    return;
                }
                const latest = await res.json();
                currentDeploymentCreatedAt = latest.created_at;
                currentDeploymentStatus = latest.status;

                // Only update terminal if log has changed
                if (latest.logs !== lastSeenLog) {
                    const isNearBottom = lastSeenLog === '' || terminal.scrollHeight - terminal.scrollTop <= terminal.clientHeight + 50;
                    if (!latest.logs && (latest.status === 'failed' || latest.status === 'cancelled')) {
                        terminal.innerText = "[SERVER] Xəta baş verdi və ya yayım ləğv edildi. Loq tapılmadı.";
                    } else if (latest.logs) {
                        terminal.innerHTML = formatLogsToHtml(latest.logs);
                    }
                    if (isNearBottom) {
                        terminal.scrollTop = terminal.scrollHeight;
                    }
                    lastSeenLog = latest.logs;
                    lastUpdateTime = Date.now();
                    const stuckBanner = document.getElementById('stuck-warning-banner');
                    if (stuckBanner) stuckBanner.style.display = 'none';
                }

                // Show/hide cancel button depending on deployment state
                if (latest.status === 'building' || latest.status === 'deploying') {
                    document.getElementById('cancel-deploy-btn').style.display = 'inline-block';
                } else {
                    document.getElementById('cancel-deploy-btn').style.display = 'none';
                }

                // Update UI stage indicators based on log contents
                updateDeploymentStages(latest.logs || '', latest.status);

                if (latest.status === 'success' || latest.status === 'failed' || latest.status === 'cancelled' || latest.status === 'stopped') {
                    stopLogPolling();
                    loadApplications();
                    document.getElementById('cancel-deploy-btn').style.display = 'none';
                    if (updateBadgeTimer) { clearInterval(updateBadgeTimer); updateBadgeTimer = null; }
                    const badge = document.getElementById('last-update-badge');
                    const statusDot = document.getElementById('stream-status-dot');
                    const stuckBanner = document.getElementById('stuck-warning-banner');
                    if (stuckBanner) stuckBanner.style.display = 'none';
                    if (badge) {
                        badge.innerText = `Yayım tamamlandı${getDeploymentTotalTime()}`;
                    }
                    if (statusDot) {
                        if (latest.status === 'success') {
                            statusDot.innerText = 'Tamamlandı ✅';
                            statusDot.style.color = 'var(--success-color)';
                            const linkBtn = document.getElementById('deploy-app-link-btn');
                            if (linkBtn) linkBtn.style.display = 'inline-block';
                        } else if (latest.status === 'stopped') {
                            statusDot.innerText = 'Dayandırıldı ⚪';
                            statusDot.style.color = '#757575';
                        } else {
                            statusDot.innerText = 'Dayandırıldı ❌';
                            statusDot.style.color = 'var(--danger-color)';
                        }
                    }
                    if (latest.status === 'cancelled') {
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
            } catch (e) {
                console.error("Error polling logs", e);
            }
        }, 1000);
    }

    initLogs();
}

function parseSqliteUtcDate(sqliteStr) {
    if (!sqliteStr) return null;
    const isoStr = sqliteStr.trim().replace(" ", "T") + "Z";
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? null : d;
}

function getDeploymentTotalTime() {
    if (currentDeploymentCreatedAt) {
        const start = parseSqliteUtcDate(currentDeploymentCreatedAt);
        if (start) {
            let diffMs = 0;
            if (currentDeploymentStatus === 'building' || currentDeploymentStatus === 'deploying') {
                diffMs = Date.now() - start.getTime();
            } else {
                let totalSec = 0;
                document.querySelectorAll('.stage-item').forEach(el => {
                    const timeEl = el.querySelector('.stage-time');
                    if (!timeEl) return;
                    const txt = timeEl.innerText.trim();
                    if (txt === '--' || txt === 'Gedir...' || txt === 'Xəta' || txt === 'Ləğv edildi') return;
                    if (txt.includes('ms')) totalSec += parseFloat(txt) / 1000;
                    else if (txt.includes('m')) {
                        const parts = txt.split('m');
                        totalSec += (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
                    } else if (txt.includes('s')) totalSec += parseFloat(txt) || 0;
                });
                if (totalSec > 0) {
                    totalSec = Math.round(totalSec);
                    return totalSec >= 60 ? ` (Toplam vaxt: ${Math.floor(totalSec/60)}d ${totalSec%60}s)` : ` (Toplam vaxt: ${totalSec}s)`;
                }
                // Fallback: əgər bitibsə amma loqlar tam deyilsə (məs. ilk anlar)
                return '';
            }
            
            let totalSec = Math.max(0, Math.round(diffMs / 1000));
            if (totalSec >= 60) {
                const m = Math.floor(totalSec / 60);
                const s = totalSec % 60;
                return ` (Toplam vaxt: ${m}d ${s}s)`;
            }
            return ` (Toplam vaxt: ${totalSec}s)`;
        }
    }
    return '';
}

// Timer for update badge
function startUpdateBadgeTimer() {
    if (updateBadgeTimer) clearInterval(updateBadgeTimer);
    updateBadgeTimer = setInterval(() => {
        if (!lastUpdateTime) return;
        const secAgo = Math.floor((Date.now() - lastUpdateTime) / 1000);
        const badge = document.getElementById('last-update-badge');
        const stuckBanner = document.getElementById('stuck-warning-banner');
        if (badge) {
            badge.innerText = `Son yeniləmə: ${secAgo}s əvvəl${getDeploymentTotalTime()}`;
        }
        if (secAgo >= 180 && stuckBanner) {
            stuckBanner.style.display = 'block';
        } else if (stuckBanner) {
            stuckBanner.style.display = 'none';
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

// Convert logs to HTML with error, success, and warning lines highlighted
function formatLogsToHtml(rawLogs) {
    if (!rawLogs) return '';
    const cleanLogs = stripAnsi(rawLogs);
    const lines = cleanLogs.split('\n');
    const formattedLines = lines.map(line => {
        let escapedLine = line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const isError = /\[error\]|error|failed|xəta|fail|stderr|critical|cannot|could not|failed to/i.test(escapedLine);
        const isSuccess = /\[success\]|success|successfully|yazıldı|deploy olundu|succeeded/i.test(escapedLine);
        const isWarning = /\[warning\]|warning|uyarı/i.test(escapedLine);

        if (isError) {
            return `<span style="color: #ff1744; font-weight: 500;">${escapedLine}</span>`;
        } else if (isSuccess) {
            return `<span style="color: #00e676; font-weight: 500;">${escapedLine}</span>`;
        } else if (isWarning) {
            return `<span style="color: #ffaa00; font-weight: 500;">${escapedLine}</span>`;
        }
        return escapedLine;
    });
    return formattedLines.join('\n');
}

// Koyeb-style stage parser based on log keywords
function updateDeploymentStages(logText, deployStatus = null) {
    const stages = [
        {
            id: 'stage-1',
            startPattern: 'Connecting to server',
            endPattern: '[SUCCESS] Workspace directory created',
            errorPattern: '[ERROR] Directory prep failed',
            pendingDesc: 'Uzaq server hazırlanır...',
            successDesc: 'Uzaq server hazırlandı',
            failedDesc: 'Hazırlıq alınmadı',
            defaultTime: '2s'
        },
        {
            id: 'stage-2',
            startPattern: '[2/5] Git repository',
            endPattern: '[SUCCESS] Repository cloned',
            errorPattern: '[ERROR] Git checkout failed',
            pendingDesc: 'Git repozitoriya klonlanır...',
            successDesc: 'Repozitoriya uğurla klonlandı',
            failedDesc: 'Klonlama alınmadı',
            defaultTime: '2s'
        },
        {
            id: 'stage-3',
            startPattern: '[3/5] Docker image build',
            endPattern: '[SUCCESS] Docker image',
            errorPattern: '[ERROR] Docker build failed',
            pendingDesc: 'Docker imici yığılır...',
            successDesc: 'Docker imici yığıldı',
            failedDesc: 'Build uğursuz oldu',
            getTime: (text) => {
                // Docker build done saniyəsini axtarır (məs: DONE 8.9s və ya DONE 129s)
                const match = text.match(/DONE\s+([\d.]+(?:s|ms))/i);
                return match ? match[1] : '93s';
            }
        },
        {
            id: 'stage-4',
            startPattern: '[4/5]',
            endPattern: '[5/5]',
            errorPattern: null,
            pendingDesc: 'Köhnə konteynerlər silinir...',
            successDesc: 'Köhnə konteynerlər təmizləndi',
            failedDesc: 'Təmizlik alınmadı',
            defaultTime: '1s'
        },
        {
            id: 'stage-5',
            startPattern: '[5/5] Yeni konteyner',
            endPattern: '[SUCCESS] T', // matches Tətbiq or TЙ™tbiq
            errorPattern: '[ERROR] Docker run command failed',
            pendingDesc: 'Yeni konteyner başladılır...',
            successDesc: 'Tətbiq uğurla işə salındı',
            failedDesc: 'Başlatmaq alınmadı',
            defaultTime: '1s'
        }
    ];

    let anyFailed = false;

    stages.forEach((stage) => {
        const el = document.getElementById(stage.id);
        if (!el) return;

        const iconEl = el.querySelector('.stage-icon');
        const descEl = el.querySelector('.stage-desc');
        const timeEl = el.querySelector('.stage-time');

        const hasStarted = logText.includes(stage.startPattern);
        const hasEnded = logText.includes(stage.endPattern);
        const hasFailed = stage.errorPattern ? logText.includes(stage.errorPattern) : false;
        const isGlobalFailed = deployStatus === 'failed' || deployStatus === 'cancelled';

        if (hasFailed || anyFailed || (isGlobalFailed && !hasEnded)) {
            el.style.opacity = '1.0';
            el.style.color = '#ff1744'; // danger color
            iconEl.innerHTML = '<svg style="width:12px;height:12px;stroke:#ff1744;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            if (descEl) descEl.innerText = stage.failedDesc;
            timeEl.innerText = 'Xəta';
            anyFailed = true;
        } else if (hasEnded) {
            el.style.opacity = '1.0';
            el.style.color = '#00e676'; // success color
            iconEl.innerHTML = '<svg style="width:12px;height:12px;stroke:#00e676;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
            if (descEl) descEl.innerText = stage.successDesc;

            // Vaxtı təyin etmək
            if (stage.getTime) {
                timeEl.innerText = stage.getTime(logText);
            } else {
                timeEl.innerText = stage.defaultTime;
            }
        } else if (hasStarted) {
            el.style.opacity = '1.0';
            el.style.color = '#00d2ff'; // accent color
            iconEl.innerHTML = '<svg class="spin-icon" style="width:12px;height:12px;stroke:#00d2ff;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;animation:spin 1s linear infinite;" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
            if (descEl) descEl.innerText = stage.pendingDesc;
            timeEl.innerText = 'Gedir...';
        } else {
            el.style.opacity = '0.4';
            el.style.color = 'var(--text-secondary)';
            iconEl.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,0.3);display:inline-block;"></span>';
            if (descEl) descEl.innerText = 'Gözlənilir';
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
