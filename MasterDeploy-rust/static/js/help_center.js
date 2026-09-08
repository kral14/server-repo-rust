async function openHelpCenter() {
    showModal('help-modal');
    switchHelpTab('help-changelog');

    const clog = document.getElementById('help-changelog');
    clog.innerHTML = 'Yüklənir...';
    if (systemVersions.length === 0) systemVersions = await fetchChangelog();
    clog.innerHTML = systemVersions.map(v => `<div style="margin-bottom: 20px;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
            <h3 style="margin: 0; color: var(--primary-color);">${v.version}</h3>
            ${v.date ? `<span style="font-size: 0.75rem; color: var(--text-secondary); background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.08);">📅 ${v.date}</span>` : ''}
        </div>
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
    if (activeBtn) {
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

// Deployments Polling Timer for Overview Tab
let overviewDeploymentsInterval = null;

async function loadAppDeployments(appId) {
    if (!appId) return;
    const container = document.getElementById('overview-deployments-list');
    if (!container) return;

    try {
        const res = await fetch(`/api/deployments/${appId}`);
        if (!res.ok) throw new Error("Failed to fetch deployments");
        const deployments = await res.json();

        if (deployments.length === 0) {
            container.innerHTML = `<div class="no-data">Hələ heç bir deployment yoxdur.</div>`;
            return;
        }

        const statusColors = {
            'success': '#00e676',
            'failed': '#ff1744',
            'deploying': '#00d2ff',
            'building': '#00d2ff',
            'cancelled': '#ff9800',
            'pending': '#9aa0a6',
            'stopped': '#757575'
        };

        container.innerHTML = deployments.map(d => {
            const color = statusColors[d.status] || '#9aa0a6';
            let date = d.created_at;
            try {
                const isoStr = d.created_at.trim().replace(" ", "T") + "Z";
                date = new Date(isoStr).toLocaleString('az-AZ');
            } catch (e) {
                console.error(e);
            }

            // Show Cancel button if building or deploying
            const showCancel = d.status === 'building' || d.status === 'deploying';
            const cancelBtn = showCancel ?
                `<button class="btn btn-secondary" onclick="cancelDeploymentFromOverview('${d.id}', '${appId}')" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; color: #ff9100; border-color: rgba(255,145,0,0.3); background: rgba(255,145,0,0.05);">🛑 Ləğv Et</button>` : '';

            return `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); padding: 0.8rem 1rem; border-radius: 8px; gap: 1rem; flex-wrap: wrap;">
                    <div style="display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap;">
                        <span style="font-family: monospace; font-size: 0.8rem; background: rgba(255,255,255,0.05); padding: 0.2rem 0.5rem; border-radius: 4px; color: #94a3b8;">#${d.id.substring(0, 8)}</span>
                        <span style="font-size: 0.75rem; color: var(--text-secondary);">${date}</span>
                        <span style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: ${color}; background: ${color}15; border: 1px solid ${color}40; padding: 0.15rem 0.5rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;">
                            ${d.status === 'building' || d.status === 'deploying' ? '🔄 ' : ''}${d.status}
                        </span>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        ${cancelBtn}
                        <button class="btn btn-secondary" onclick="viewDeploymentLogs('${appId}', '${d.id}')" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;">📋 Loqlar</button>
                    </div>
                </div>
            `;
        }).join('');

        // Set up periodic polling for overview deployments if tab is active and there's a building deploy
        const hasActiveDeploy = deployments.some(d => d.status === 'building' || d.status === 'deploying');
        if (hasActiveDeploy) {
            startOverviewDeploymentsPolling(appId);
        } else {
            stopOverviewDeploymentsPolling();
        }

    } catch (e) {
        console.error("Failed to load deployments for overview", e);
        container.innerHTML = `<div class="no-data" style="color: var(--danger-color);">Tarixçə yüklənərkən xəta baş verdi.</div>`;
    }
}

function viewDeploymentLogs(appId, deployId = null) {
    switchAppTab('logs');
    if (deployId) {
        viewLogs(appId, false, deployId);
    }
}

async function onLogDeploymentChange() {
    const selector = document.getElementById('log-deployment-selector');
    if (!selector) return;
    const val = selector.value;
    if (val === 'latest') {
        viewLogs(currentAppId, false, null);
    } else {
        viewLogs(currentAppId, false, val);
    }
}

async function cancelDeploymentFromOverview(deployId, appId) {
    showConfirmCard({
        icon: '🛑',
        title: 'Yayımı Ləğv Et?',
        subtitle: 'Seçilmiş deployment dayandırılacaq',
        body: 'Bu deployment-i ləğv etmək istədiyinizdən əminsiniz?',
        confirmText: '🛑 Bəli, Ləğv Et',
        confirmStyle: 'background: #ff9100; color: white;',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/deploy/cancel/${deployId}`, { method: 'POST' });
                if (res.ok) {
                    addActivityLog('Yayım ləğv edildi', 'delete');
                    loadAppDeployments(appId);
                    loadApplications();
                }
            } catch (e) {
                console.error("Failed to cancel deployment from overview", e);
            }
        }
    });
}

function startOverviewDeploymentsPolling(appId) {
    if (overviewDeploymentsInterval) return;
    overviewDeploymentsInterval = setInterval(() => {
        const overviewTab = document.getElementById('subtab-overview');
        if (overviewTab && overviewTab.style.display === 'block' && currentAppDetailsId === appId) {
            loadAppDeployments(appId);
        } else {
            stopOverviewDeploymentsPolling();
        }
    }, 3000);
}

function stopOverviewDeploymentsPolling() {
    if (overviewDeploymentsInterval) {
        clearInterval(overviewDeploymentsInterval);
        overviewDeploymentsInterval = null;
    }
}

// Modify switchAppTab to stop/start polling appropriately
const originalSwitchAppTab = switchAppTab;
switchAppTab = function (tabId) {
    originalSwitchAppTab(tabId);
    if (tabId === 'overview' && currentAppDetailsId) {
        loadAppDeployments(currentAppDetailsId);
    } else {
        stopOverviewDeploymentsPolling();
    }
};

function updateDebugButtonUI(isDebug) {
    const btn = document.getElementById('debug-toggle-btn');
    if (btn) {
        if (isDebug) {
            btn.classList.add('active');
            btn.style.background = 'rgba(255, 184, 108, 0.25)';
            btn.style.borderColor = '#ffb86c';
            btn.title = 'Debug Rejimi: Aktivdir (Söndürmək üçün klikləyin)';
        } else {
            btn.classList.remove('active');
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.title = 'Debug Rejimi (Aktivləşdirmək üçün klikləyin)';
        }
    }
}

// --- Debug mode outline details and copying system ---
function toggleDebugMode() {
    document.body.classList.toggle('debug-mode');
    const isDebug = document.body.classList.contains('debug-mode');
    localStorage.setItem('debug_mode', isDebug ? 'true' : 'false');
    updateDebugButtonUI(isDebug);
    if (typeof updateDebugDimensions === 'function') {
        updateDebugDimensions();
    }
    if (isDebug) {
        initDebugTooltips();
    } else {
        removeDebugTooltips();
    }
}

function initDebugTooltips() {
    if (!document.body.classList.contains('debug-mode')) return;

    const debugComponents = [
        { selector: '.app-container', name: 'App Container', color: 'Deep Pink (#e91e63)' },
        { selector: '.sidebar', name: 'Sidebar', color: 'Orange (#ff9800)' },
        { selector: '.main-content', name: 'Main Content', color: 'Green (#00e676)' },
        { selector: '#subtab-logs', name: 'Logs Tab Container', color: 'Purple (#9c27b0)' },
        { selector: '.logs-tabs-container', name: 'Logs Sub-Tabs Container', color: 'Cyan (#00bcd4)' },
        { selector: '.log-panels-wrapper', name: 'Log Panels Wrapper', color: 'Blue (#3f51b5)' },
        { selector: '.terminal-toolbar', name: 'Terminal Toolbar', color: 'Yellow (#ffeb3b)' },
        { selector: '.terminal-body', name: 'Terminal Body', color: 'Lime (#cddc39)' },
        { selector: '#stages-container', name: 'Stages Container', color: 'Coral (#ff5722)' },
        { selector: '.stage-item', name: 'Stage Item', color: 'Light Blue (#03a9f4)' },
        { selector: '.logo-area', name: 'Logo Area', color: 'Pink (#e91e63)' },
        { selector: '.nav-menu', name: 'Navigation Menu', color: 'Forest Green (#4caf50)' },
        { selector: '.nav-btn', name: 'Navigation Button', color: 'Light Purple (#9c27b0)' },
        { selector: '.log-tab-btn', name: 'Log Tab Button', color: 'Light Orange (#ff9800)' },
        { selector: '.theme-toggle-container', name: 'Theme Toggle Container', color: 'Light Cyan (#00bcd4)' },
        { selector: '.status-footer', name: 'Status Footer', color: 'Brown (#795548)' }
    ];

    debugComponents.forEach(comp => {
        const elements = document.querySelectorAll(comp.selector);
        elements.forEach(el => {
            if (el.dataset.debugInited) return;
            el.dataset.debugInited = "true";

            el.addEventListener('mouseenter', (e) => {
                if (!document.body.classList.contains('debug-mode')) return;
                showDebugTooltip(el, comp.name, comp.color);
            });
        });
    });
}

function showDebugTooltip(element, name, color) {
    if (element.querySelector('.debug-tooltip')) return;

    const tooltip = document.createElement('div');
    tooltip.className = 'debug-tooltip';
    tooltip.style.cssText = `
        position: absolute;
        top: 2px;
        left: 2px;
        background: #111;
        color: #fff;
        border: 1px solid #555;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        font-family: monospace;
        z-index: 1000000;
        cursor: pointer;
        user-select: none;
        pointer-events: auto;
        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    `;
    tooltip.innerHTML = `📍 <strong>${name}</strong> <span style="color:#aaa;">(${color})</span>`;

    const originalPos = window.getComputedStyle(element).position;
    if (originalPos === 'static') {
        element.style.position = 'relative';
    }

    tooltip.addEventListener('click', (e) => {
        e.stopPropagation();
        const copyText = `${name} (${color})`;
        navigator.clipboard.writeText(copyText).then(() => {
            const origHTML = tooltip.innerHTML;
            tooltip.innerHTML = `✅ Copied!`;
            setTimeout(() => {
                tooltip.innerHTML = origHTML;
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy', err);
        });
    });

    element.appendChild(tooltip);
}

function removeDebugTooltips() {
    document.querySelectorAll('.debug-tooltip').forEach(t => t.remove());
}

document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('debug-mode')) return;
    if (!e.target.closest('.debug-tooltip')) {
        removeDebugTooltips();
    }
});

// Auto-run debug tooltips on page load if active
window.addEventListener('load', () => {
    const isDebug = localStorage.getItem('debug_mode') === 'true' || document.body.classList.contains('debug-mode');
    updateDebugButtonUI(isDebug);
    if (isDebug) {
        document.body.classList.add('debug-mode');
        setTimeout(initDebugTooltips, 500);
        if (typeof updateDebugDimensions === 'function') {
            setTimeout(updateDebugDimensions, 500);
        }
    }
});

// Hook dynamic rendering
const originalLoadApplications = loadApplications;
loadApplications = async function () {
    await originalLoadApplications();
    setTimeout(initDebugTooltips, 500);
};

const originalViewLogs = viewLogs;
viewLogs = function (appId, switchMainTab = true, specificDeployId = null) {
    originalViewLogs(appId, switchMainTab, specificDeployId);
    setTimeout(initDebugTooltips, 500);
};

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
