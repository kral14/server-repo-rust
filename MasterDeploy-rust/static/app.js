let githubToken = '';
let currentDeploymentCreatedAt = null;
let currentDeploymentStatus = null;
let globalApps = [];
let deletionLogsCache = {};

// Deploy növü seçimindən asılı olaraq sahələri gizlədib-göstərir
// prefix: 'app' | 'settings' | 'wiz'
function toggleDeployTypeFields(prefix) {
    const deployType = document.getElementById(`${prefix}-deploy-type`)?.value;
    const imageInputs = document.getElementById(`${prefix}-image-inputs`);
    const gitWrapper = document.getElementById(`${prefix}-git-section-wrapper`);

    if (!deployType) return;

    if (deployType === 'image') {
        if (imageInputs) imageInputs.style.display = 'block';
        if (gitWrapper) gitWrapper.style.display = 'none';
    } else {
        if (imageInputs) imageInputs.style.display = 'none';
        if (gitWrapper) gitWrapper.style.display = 'block';
    }
}

// --- Modular UI Load Indicators (Global declarations at top to avoid TDZ errors) ---
let isKeysTokensUILoaded = false;
let isServersUILoaded = false;
let isApplicationsUILoaded = false;
let isKeysTokensUILoading = false;
let isServersUILoading = false;
let isApplicationsUILoading = false;

// --- Dynamic Module Proxies to prevent undefined ReferenceErrors ---
function stopLogPolling() {
    if (window.stopLogPolling && !window.stopLogPolling.isStub) {
        window.stopLogPolling();
    }
}
stopLogPolling.isStub = true;

function stopOverviewDeploymentsPolling() {
    if (window.stopOverviewDeploymentsPolling && !window.stopOverviewDeploymentsPolling.isStub) {
        window.stopOverviewDeploymentsPolling();
    }
}
stopOverviewDeploymentsPolling.isStub = true;

async function openAppDetails(appId, autoSwitch = true) {
    if (window.openAppDetails && !window.openAppDetails.isStub) {
        return window.openAppDetails(appId, autoSwitch);
    }
    await loadApplicationsModularUI();
    if (window.openAppDetails && !window.openAppDetails.isStub) {
        return window.openAppDetails(appId, autoSwitch);
    }
}
openAppDetails.isStub = true;

async function loadApplications() {
    if (window.loadApplications && !window.loadApplications.isStub) {
        return window.loadApplications();
    }
    await loadApplicationsModularUI();
    if (window.loadApplications && !window.loadApplications.isStub) {
        return window.loadApplications();
    }
}
loadApplications.isStub = true;

async function loadServers() {
    if (window.loadServers && !window.loadServers.isStub) {
        return window.loadServers();
    }
    await loadServersModularUI();
    if (window.loadServers && !window.loadServers.isStub) {
        return window.loadServers();
    }
}
loadServers.isStub = true;

async function fetchServerStats() {
    try {
        const res = await fetch('/api/servers');
        if (res.ok) {
            const servers = await res.json();
            const statCountEl = document.getElementById('stat-servers-count');
            if (statCountEl) {
                statCountEl.innerText = servers.length;
            }
        }
        const appsRes = await fetch('/api/applications');
        if (appsRes.ok) {
            const apps = await appsRes.json();
            const statAppsEl = document.getElementById('stat-apps-count');
            if (statAppsEl) {
                statAppsEl.innerText = apps.length;
            }
        }
    } catch (e) {
        console.error("Dashboard stats xətası", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadKeysTokensModularUI();
    loadGithubToken();
    fetchAppVersion();
    renderActivityLogs();

    // Inject Taskbar / Footer
    const taskbar = document.createElement('div');
    taskbar.id = 'desktop-taskbar';
    taskbar.style.cssText = `
        position: fixed; bottom: 10px; left: 10px; right: 10px; height: 36px; 
        background: rgba(30, 30, 30, 0.85); backdrop-filter: blur(12px); 
        border: 1px solid #333; border-radius: 8px; display: flex; align-items: center; 
        justify-content: space-between; padding: 0 20px; z-index: 10000; 
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;
    taskbar.innerHTML = `
        <div id="taskbar-windows" style="display: flex; gap: 8px; align-items: center; flex: 1; overflow-x: auto;"></div>
        <div style="font-size: 0.8rem; color: #888; display: flex; align-items: center; gap: 15px; font-family: monospace;">
            <span id="footer-time">00:00:00</span>
        </div>
    `;
    document.body.appendChild(taskbar);

    setInterval(() => {
        const timeEl = document.getElementById('footer-time');
        if (timeEl) {
            timeEl.innerText = new Date().toLocaleTimeString();
        }
    }, 1000);

    // Restore active tab
    const activeTab = localStorage.getItem('active_tab') || 'dashboard';
    if (activeTab === 'app-details') {
        const appId = localStorage.getItem('active_app_id');
        const subTab = localStorage.getItem('active_app_subtab') || 'overview';
        if (appId) {
            loadApplicationsModularUI().then(() => {
                if (typeof window.openAppDetails === 'function') {
                    window.openAppDetails(appId, false).then(() => {
                        if (typeof window.switchAppTab === 'function') {
                            window.switchAppTab(subTab);
                        }
                    });
                }
            });
        } else {
            switchTab('applications');
        }
    } else {
        switchTab(activeTab);
    }

    // Fetch server stats periodically
    fetchServerStats();

    // Theme Toggle Logic
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
        updateThemeUI();
        themeBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeUI();
        });
    }
});

function updateThemeUI() {
    const theme = document.documentElement.getAttribute('data-theme');
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (theme === 'light') {
        icon.innerText = '🌙';
        text.innerText = 'Qara Tema';
    } else {
        icon.innerText = '☀️';
        text.innerText = 'Açıq Tema';
    }
}

async function fetchAppVersion() {
    try {
        const res = await fetch('/api/version');
        if (res.ok) {
            const data = await res.json();
            const el = document.getElementById('app-version');
            if (el && data.version) {
                const localVersion = data.version;
                // Yalnız versiya mətnini göstər, kliklenebilir et
                // Badge məntiqi initSystemUpdates() tərəfindən idarə olunur
                el.innerHTML = `<span id="version-text" onclick="openSystemUpdateModal()" style="cursor:pointer; text-decoration:underline; text-underline-offset:3px;" title="Versiyalara bax">v${localVersion}</span> <span id="version-badge"></span>`;
            }
        }
    } catch (e) {
        // silently ignore
    }
}

function copyTerminalLogs(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.innerText || el.textContent;

    function showSuccess() {
        const btn = document.getElementById('copy-logs-btn');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '✅ Kopyalandı!';
            btn.style.color = 'var(--success-color)';
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.style.color = 'var(--text-secondary)';
            }, 2000);
        }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showSuccess).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showSuccess();
        } catch (e) {
            console.error('Copy failed', e);
        }
        document.body.removeChild(ta);
    }
}

// Tab Switching Logic
function initTabs() {
    const navButtons = document.querySelectorAll('.nav-btn');

    navButtons.forEach(btn => {
        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return; // Skip buttons without data-tab (like modal triggers)

        btn.addEventListener('click', () => {
            switchTab(targetTab);
        });
    });
}

// --- Desktop Window Management System ---
const activeWindows = {};
const minimizedWindows = {};
let maxZIndex = 1000;

const windowNames = {
    'github-modal': '⚙️ GitHub Ayarları',
    'activity-log-modal': '📋 Fəaliyyət Jurnalı',
    'server-modal': '🖥️ Server Əlavə Et',
    'server-edit-modal': '✏️ Server Redaktə Et',
    'server-conn-modal': '🔌 Server Bağlantı Ayarları',
    'server-console-modal': '💻 SSH Konsolu',
    'server-volumes-modal': '💾 Docker Volumları & Disk',
    'app-settings-modal': '⚙️ Layihə Ayarları',
    'cf-terminal-modal': '☁️ Cloudflare Terminalı',
    'logs-modal': '📋 Layihə Loqları',
    'system-update-modal': '🔄 Sistem Yeniləmələri',
    'help-modal': '💡 Kömək Mərkəzi',
    'create-service-modal': '🚀 Yeni Layihə',
    'delete-terminal-modal': '🗑️ Layihə Silinməsi',
    'ssh-key-modal': '🔑 SSH Açar Əlavə Et',
    'rsa-result-modal': '🔑 RSA Açar Cütü'
};

function saveWindowPosition(id, card) {
    if (card.classList.contains('maximized')) return;
    const pos = {
        width: card.style.width,
        height: card.style.height,
        top: card.style.top,
        left: card.style.left
    };
    localStorage.setItem(`win_pos_${id}`, JSON.stringify(pos));
}

function applySavedPosition(id, card) {
    const saved = localStorage.getItem(`win_pos_${id}`);
    if (saved) {
        try {
            const pos = JSON.parse(saved);
            if (pos.width) card.style.width = pos.width;
            if (pos.height) card.style.height = pos.height;
            if (pos.top) card.style.top = pos.top;
            if (pos.left) card.style.left = pos.left;
        } catch (e) {
            console.error("Error parsing saved position", e);
        }
    }
}

function initializeWindow(backdropId, titleText) {
    const backdrop = document.getElementById(backdropId);
    if (!backdrop || backdrop.dataset.windowInitialized) return;

    backdrop.dataset.windowInitialized = "true";
    backdrop.style.pointerEvents = 'none';
    backdrop.style.background = 'transparent';
    backdrop.style.backdropFilter = 'none';
    backdrop.style.position = 'fixed';

    let card = backdrop.querySelector('.modal-card');
    if (!card) return;

    // Save existing elements inside modal-card
    const existingContent = document.createDocumentFragment();
    while (card.firstChild) {
        existingContent.appendChild(card.firstChild);
    }

    // Set standard styles on card
    card.style.pointerEvents = 'auto';
    card.style.position = 'fixed';
    card.style.margin = '0';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.overflow = 'hidden';
    card.style.maxWidth = 'none';
    card.style.maxHeight = 'none';

    applySavedPosition(backdropId, card);
    if (!card.style.top || card.style.top === '') {
        const isTerminal = ['deploy-modal', 'cf-terminal-modal', 'logs-modal'].includes(backdropId);
        card.style.top = isTerminal ? '40px' : '100px';
        const cardWidth = card.offsetWidth || 530;
        // Pəncərənin sağ tərəfə girməməsi üçün 60px sola çəkirik
        card.style.left = `calc(50vw - ${cardWidth / 2}px - 60px)`;
    }

    // Reconstruct card layout with standard Header, Body, and Resizers
    card.innerHTML = `
        <!-- Window Header -->
        <div class="win-header">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div class="neuro-logo"></div>
                <span class="win-title-text">${titleText}</span>
            </div>
            <div class="window-controls" style="display: flex; gap: 12px; align-items: center;">
                <button class="win-btn-min" title="Kiçilt"></button>
                <div class="win-btn-max-container">
                    <button class="win-btn-max" title="Böyüt"></button>
                    <div class="snap-layout-menu">
                        <!-- Split Layout Block (Sola / Sağa 2 Böyük Pəncərə Seçimi) -->
                        <div class="snap-block split-layout" style="display: flex; flex-direction: row; gap: 4px; padding: 4px; width: 60px; height: 45px;">
                            <div class="snap-zone zone-left" onclick="snapWindow('${backdropId}', 'left'); event.stopPropagation();" title="Sola yerləşdir (50%)" style="flex: 1; height: 100%; background: rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; transition: all 0.2s;"></div>
                            <div class="snap-zone zone-right" onclick="snapWindow('${backdropId}', 'right'); event.stopPropagation();" title="Sağa yerləşdir (50%)" style="flex: 1; height: 100%; background: rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; transition: all 0.2s;"></div>
                        </div>
                        
                        <!-- Full Screen Layout Block -->
                        <div class="snap-block full-layout" onclick="snapWindow('${backdropId}', 'full'); event.stopPropagation();" title="Tam Ekran" style="display: block; padding: 4px; width: 60px; height: 45px;">
                            <div class="snap-zone zone-full" style="width: 100%; height: 100%; background: rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; transition: all 0.2s;"></div>
                        </div>
                        
                        <!-- Centered Layout Block -->
                        <div class="snap-block center-layout" onclick="snapWindow('${backdropId}', 'center'); event.stopPropagation();" title="Mərkəzə yerləşdir" style="display: flex; justify-content: center; align-items: center; padding: 4px; width: 60px; height: 45px;">
                            <div class="snap-zone zone-center" style="width: 70%; height: 100%; background: rgba(255, 255, 255, 0.2); border-radius: 3px; cursor: pointer; transition: all 0.2s;"></div>
                        </div>
                    </div>
                </div>
                <button class="win-btn-close" title="Bağla"></button>
            </div>
        </div>
        
        <!-- Window Body Container -->
        <div class="win-body">
            <!-- Content goes here -->
        </div>
        
        <!-- Resize Handles -->
        <div class="resize-handle resizer-t" style="position: absolute; top: 0; left: 0; right: 0; height: 6px; cursor: n-resize; z-index: 10;"></div>
        <div class="resize-handle resizer-b" style="position: absolute; bottom: 0; left: 0; right: 0; height: 6px; cursor: s-resize; z-index: 10;"></div>
        <div class="resize-handle resizer-l" style="position: absolute; top: 0; bottom: 0; left: 0; width: 6px; cursor: w-resize; z-index: 10;"></div>
        <div class="resize-handle resizer-r" style="position: absolute; top: 0; bottom: 0; right: 0; width: 6px; cursor: e-resize; z-index: 10;"></div>
        <div class="resize-handle resizer-tl" style="position: absolute; top: 0; left: 0; width: 10px; height: 10px; cursor: nw-resize; z-index: 11;"></div>
        <div class="resize-handle resizer-tr" style="position: absolute; top: 0; right: 0; width: 10px; height: 10px; cursor: ne-resize; z-index: 11;"></div>
        <div class="resize-handle resizer-bl" style="position: absolute; bottom: 0; left: 0; width: 10px; height: 10px; cursor: sw-resize; z-index: 11;"></div>
        <div class="resize-handle resizer-br" style="position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; cursor: se-resize; z-index: 11;"></div>
    `;

    card.querySelector('.win-body').appendChild(existingContent);

    // Hide duplicate H2 titles in content
    const oldH2 = card.querySelector('.win-body h2');
    if (oldH2) oldH2.style.display = 'none';

    // Bind controls
    card.querySelector('.win-btn-min').onclick = (e) => { e.stopPropagation(); minimizeWindow(backdropId); };
    card.querySelector('.win-btn-max').onclick = (e) => { e.stopPropagation(); maximizeWindow(backdropId); };
    card.querySelector('.win-btn-close').onclick = (e) => { e.stopPropagation(); closeModal(backdropId); };
    const header = card.querySelector('.win-header');
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    // Double click to maximize/restore window
    header.addEventListener('dblclick', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        maximizeWindow(backdropId);
    });

    header.addEventListener('mousedown', (e) => {
        bringToFront(backdropId);
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = card.offsetLeft;
        initialTop = card.offsetTop;

        const onMouseMove = (ev) => {
            if (!isDragging) return;
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            
            let nextLeft = initialLeft + dx;
            let nextTop = initialTop + dy;
            
            // Constrain within screen boundaries so the header is always reachable
            const cardWidth = card.offsetWidth || 530;
            const headerHeight = header.offsetHeight || 40;
            const minVisibleSide = 100; // at least 100px of side must remain visible
            
            if (nextTop < 0) nextTop = 0; // Header can't go above top edge
            if (nextTop > window.innerHeight - headerHeight - 40) nextTop = window.innerHeight - headerHeight - 40; // Can't drop below taskbar
            if (nextLeft < -cardWidth + minVisibleSide) nextLeft = -cardWidth + minVisibleSide;
            if (nextLeft > window.innerWidth - minVisibleSide) nextLeft = window.innerWidth - minVisibleSide;
            
            card.style.left = nextLeft + 'px';
            card.style.top = nextTop + 'px';
        };

        const onMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            saveWindowPosition(backdropId, card); // Yadda saxla
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });

    // Bind resizing handles
    setupWindowResize(card);

    card.addEventListener('mousedown', () => {
        bringToFront(backdropId);
    });
}

function setupWindowResize(card) {
    const resizers = card.querySelectorAll('.resize-handle');
    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const rect = card.getBoundingClientRect();
            const startX = e.clientX;
            const startY = e.clientY;

            const onMouseMove = (ev) => {
                let dx = ev.clientX - startX;
                let dy = ev.clientY - startY;

                if (resizer.classList.contains('resizer-r')) {
                    card.style.width = (rect.width + dx) + 'px';
                }
                if (resizer.classList.contains('resizer-b')) {
                    card.style.height = (rect.height + dy) + 'px';
                }
                if (resizer.classList.contains('resizer-l')) {
                    card.style.width = (rect.width - dx) + 'px';
                    card.style.left = (rect.left + dx) + 'px';
                }
                if (resizer.classList.contains('resizer-t')) {
                    card.style.height = (rect.height - dy) + 'px';
                    card.style.top = (rect.top + dy) + 'px';
                }
                if (resizer.classList.contains('resizer-br')) {
                    card.style.width = (rect.width + dx) + 'px';
                    card.style.height = (rect.height + dy) + 'px';
                }
                if (resizer.classList.contains('resizer-tr')) {
                    card.style.width = (rect.width + dx) + 'px';
                    card.style.height = (rect.height - dy) + 'px';
                    card.style.top = (rect.top + dy) + 'px';
                }
                if (resizer.classList.contains('resizer-bl')) {
                    card.style.width = (rect.width - dx) + 'px';
                    card.style.left = (rect.left + dx) + 'px';
                    card.style.height = (rect.height + dy) + 'px';
                }
                if (resizer.classList.contains('resizer-tl')) {
                    card.style.width = (rect.width - dx) + 'px';
                    card.style.left = (rect.left + dx) + 'px';
                    card.style.height = (rect.height - dy) + 'px';
                    card.style.top = (rect.top + dy) + 'px';
                }

                // Resize əsnasında terminal yazılarının sürüşməsini təmin edirik
                const terminals = card.querySelectorAll('.terminal-body, #cf-terminal-body, #live-terminal-body');
                terminals.forEach(t => t.scrollTop = t.scrollHeight);
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                const backdropId = card.closest('.modal-backdrop')?.id;
                if (backdropId) {
                    saveWindowPosition(backdropId, card);
                }

                // Resize bitdikdə son sətirlərə sürüşdür
                const terminals = card.querySelectorAll('.terminal-body, #cf-terminal-body, #live-terminal-body');
                terminals.forEach(t => t.scrollTop = t.scrollHeight);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

function bringToFront(windowId) {
    const backdrop = document.getElementById(windowId);
    if (!backdrop) return;
    const card = backdrop.querySelector('.modal-card');
    if (!card) return;

    maxZIndex++;
    card.style.zIndex = maxZIndex;
    backdrop.style.zIndex = maxZIndex;
}

function minimizeWindow(windowId) {
    const backdrop = document.getElementById(windowId);
    if (!backdrop) return;
    backdrop.classList.add('minimized');
    minimizedWindows[windowId] = true;
    updateTaskbar();
}

function restoreWindow(windowId) {
    const backdrop = document.getElementById(windowId);
    if (!backdrop) return;
    backdrop.classList.remove('minimized');
    bringToFront(windowId);
    delete minimizedWindows[windowId];
    updateTaskbar();
}

function maximizeWindow(windowId) {
    const backdrop = document.getElementById(windowId);
    if (!backdrop) return;
    const card = backdrop.querySelector('.modal-card');
    if (!card) return;

    if (card.classList.contains('maximized')) {
        card.classList.remove('maximized');
        card.style.width = card.dataset.prevWidth || '530px';
        card.style.height = card.dataset.prevHeight || 'auto';
        card.style.top = card.dataset.prevTop || '100px';
        card.style.left = card.dataset.prevLeft || '30%';
        card.style.maxWidth = 'none';
        card.style.maxHeight = 'none';
        card.style.borderRadius = '12px';
    } else {
        card.dataset.prevWidth = card.style.width || '';
        card.dataset.prevHeight = card.style.height || '';
        card.dataset.prevTop = card.style.top || '';
        card.dataset.prevLeft = card.style.left || '';

        card.classList.add('maximized');
        card.style.width = '100vw';
        card.style.height = 'calc(100vh - 50px)';
        card.style.top = '0';
        card.style.left = '0';
        card.style.maxWidth = 'none';
        card.style.maxHeight = 'none';
        card.style.borderRadius = '0';
    }
}

function snapWindow(windowId, direction) {
    const backdrop = document.getElementById(windowId);
    if (!backdrop) return;
    const card = backdrop.querySelector('.modal-card');
    if (!card) return;

    if (!card.classList.contains('maximized')) {
        card.dataset.prevWidth = card.style.width || '';
        card.dataset.prevHeight = card.style.height || '';
        card.dataset.prevTop = card.style.top || '';
        card.dataset.prevLeft = card.style.left || '';
    }

    card.classList.remove('maximized');
    card.style.maxWidth = 'none';
    card.style.maxHeight = 'none';
    card.style.borderRadius = '12px';

    if (direction === 'left') {
        card.style.width = '50vw';
        card.style.height = 'calc(100vh - 50px)';
        card.style.top = '0';
        card.style.left = '0';
        card.style.borderRadius = '0';
    } else if (direction === 'right') {
        card.style.width = '50vw';
        card.style.height = 'calc(100vh - 50px)';
        card.style.top = '0';
        card.style.left = '50vw';
        card.style.borderRadius = '0';
    } else if (direction === 'full') {
        maximizeWindow(windowId);
    } else if (direction === 'center') {
        card.style.width = card.dataset.prevWidth || '530px';
        card.style.height = card.dataset.prevHeight || 'auto';
        card.style.top = '100px';
        const cardWidth = card.offsetWidth || 530;
        card.style.left = `calc(50vw - ${cardWidth / 2}px)`;
    }
}

function updateTaskbar() {
    const container = document.getElementById('taskbar-windows');
    if (!container) return;

    container.innerHTML = '';

    Object.keys(activeWindows).forEach(winId => {
        const isMin = minimizedWindows[winId] || false;
        const name = windowNames[winId] || '💻 Pəncərə';

        const btn = document.createElement('button');
        btn.style.cssText = `
            background: ${isMin ? 'rgba(255,255,255,0.08)' : 'rgba(0, 210, 255, 0.15)'};
            color: #fff;
            border: 1px solid ${isMin ? '#444' : 'var(--accent-color)'};
            border-radius: 6px;
            padding: 5px 12px;
            cursor: pointer;
            font-size: 0.8rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        `;
        btn.innerHTML = `
            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isMin ? '#ff9800' : '#00e676'};"></span>
            ${name}
        `;

        btn.onclick = () => {
            if (isMin) {
                restoreWindow(winId);
            } else {
                minimizeWindow(winId);
            }
        };
        container.appendChild(btn);
    });
}

// Premium Toast Notifications System
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
        min-width: 280px;
        padding: 12px 20px;
        border-radius: 8px;
        background: rgba(18, 20, 30, 0.9);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        color: #fff;
        font-family: inherit;
        font-size: 0.88rem;
        display: flex;
        align-items: center;
        gap: 10px;
        pointer-events: auto;
        opacity: 0;
        transform: translateY(-20px);
        transition: all 0.35s cubic-bezier(0.68, -0.55, 0.27, 1.55);
        border: 1px solid rgba(255,255,255,0.08);
    `;

    let icon = 'ℹ️';
    if (type === 'success') {
        icon = '✅';
        toast.style.borderLeft = '4px solid #00e676';
    } else if (type === 'warning') {
        icon = '⚠️';
        toast.style.borderLeft = '4px solid #ff9800';
    } else if (type === 'error') {
        icon = '❌';
        toast.style.borderLeft = '4px solid #ff1744';
    } else {
        toast.style.borderLeft = '4px solid #00d2ff';
    }

    toast.innerHTML = `<span style="font-size: 1.1rem; line-height: 1;">${icon}</span><span style="flex:1;">${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px) scale(0.9)';
        setTimeout(() => {
            toast.remove();
            if (container.children.length === 0) {
                container.remove();
            }
        }, 350);
    }, 4000);
}

// Modal management
function showModal(id) {
    const backdrop = document.getElementById(id);
    if (!backdrop) return;

    backdrop.classList.add('active');
    backdrop.style.display = 'flex';

    const name = windowNames[id] || '💻 Pəncərə';
    initializeWindow(id, name);
    const card = backdrop.querySelector('.modal-card');
    if (card) {
        applySavedPosition(id, card);
    }

    if (id === 'server-modal') {
        if (typeof loadSshKeysDropdown === 'function') {
            loadSshKeysDropdown('srv-key-id');
        }
    }

    activeWindows[id] = true;
    delete minimizedWindows[id];

    bringToFront(id);
    updateTaskbar();
}

// Global modal close logic
function closeModal(id) {
    const backdrop = document.getElementById(id);
    if (!backdrop) return;

    backdrop.classList.remove('active');
    backdrop.style.display = 'none';

    delete activeWindows[id];
    delete minimizedWindows[id];

    if (id === 'logs-modal') {
        stopLogPolling();
    }

    updateTaskbar();
}

// Load servers from Rust API
// --- Server Management JS Logic (Modularized in servers.js) ---
function toggleDeployTypeFields(context) {
    const typeSelect = document.getElementById(`${context}-deploy-type`);
    const imgInputs = document.getElementById(`${context}-image-inputs`);
    const gitInputs = document.getElementById(`${context}-git-section-wrapper`);
    const builderSection = document.getElementById(`${context}-builder-content`);

    if (!typeSelect) return;

    if (typeSelect.value === 'image') {
        if (imgInputs) imgInputs.style.display = 'block';
        if (gitInputs) gitInputs.style.display = 'none';
        
        // Settings panelində Builder bölməsini də gizlədirik (çünki build getmir)
        if (context === 'settings') {
            const accordionBuilder = document.getElementById('settings-builder-content');
            if (accordionBuilder) {
                // Həmin accordion header-i də gizlədə bilərik
                const accordionSection = accordionBuilder.parentElement;
                if (accordionSection) accordionSection.style.display = 'none';
            }
        }
    } else {
        if (imgInputs) imgInputs.style.display = 'none';
        if (gitInputs) gitInputs.style.display = 'block';
        
        if (context === 'settings') {
            const accordionBuilder = document.getElementById('settings-builder-content');
            if (accordionBuilder) {
                const accordionSection = accordionBuilder.parentElement;
                if (accordionSection) accordionSection.style.display = 'flex';
            }
        }
    }
}

// Load applications from Rust API
// --- Applications JS Logic (Modularized in applications.js) ---

// GitHub Integration Functions
async function loadGithubToken() {
    try {
        const res = await fetch('/api/settings/github-token');
        if (res.ok) {
            const data = await res.json();
            githubToken = data.token || '';
            if (githubToken) {
                document.getElementById('gh-token').value = githubToken;
                verifyGithubToken(githubToken);
            }
        }
    } catch (e) {
        console.error("Failed to load GitHub token", e);
    }
}

async function saveGithubToken() {
    const token = document.getElementById('gh-token').value.trim();
    try {
        const res = await fetch('/api/settings/github-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        if (res.ok) {
            githubToken = token;
            if (!token) {
                document.getElementById('gh-status').innerText = "Məlumat yoxdur";
                document.getElementById('gh-status').style.color = "#94a3b8";
                document.getElementById('app-repo-select').innerHTML = '<option value="">Token quraşdırılmayıb</option>';
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
    statusText.innerText = "Yoxlanılır...";
    statusText.style.color = "#00d2ff";

    try {
        const res = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `token ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            statusText.innerText = `Qoşulub: @${user.login} ✅`;
            statusText.style.color = "#00e676";
            if (activeSourceMode === 'github') {
                loadGithubRepos();
            }
            // Auto close modal after successful save
            setTimeout(() => {
                closeModal('github-modal');
            }, 1000);
        } else {
            statusText.innerText = "Token səhvdir ❌";
            statusText.style.color = "#ff1744";
        }
    } catch (e) {
        statusText.innerText = "Bağlantı xətası ❌";
        statusText.style.color = "#ff1744";
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

// Global Tab Switcher Helper
function switchTab(tabId) {
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabSections = document.querySelectorAll('.tab-section');

    navButtons.forEach(b => {
        if (b.getAttribute('data-tab') === tabId) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });

    tabSections.forEach(s => {
        if (s.id === `tab-${tabId}`) {
            s.classList.add('active');
        } else {
            s.classList.remove('active');
        }
    });

    // Persist active tab selection
    localStorage.setItem('active_tab', tabId);

    if (tabId === 'keys-tokens') {
        loadKeysTokensModularUI();
    }

    if (tabId === 'servers') {
        loadServersModularUI();
    }

    if (tabId === 'applications' || tabId === 'app-details') {
        loadApplicationsModularUI();
    }

    if (tabId !== 'deployment-logs') {
        stopLogPolling();
    }

    if (document.body.classList.contains('debug-mode')) {
        // Delay slightly to allow transition animations to finish
        setTimeout(updateDebugDimensions, 100);
    }
}

// Koyeb-style Wizard Variables
let wizSelectedSource = '';
let wizSelectedRepo = null; // { full_name, private, clone_url }
let wizSelectedBuildOption = 'buildpack';

function showCreateServiceTab() {
    wizSelectedSource = '';
    wizSelectedRepo = null;
    wizSelectedBuildOption = 'buildpack';

    // Select default buildpack card active class
    document.getElementById('buildpack-card').classList.add('active');
    document.getElementById('dockerfile-card').classList.remove('active');

    // Reset inputs
    document.getElementById('manual-public-repo').value = '';
    document.getElementById('repo-search').value = '';

    goToStep(1);
    showModal('create-service-modal');
}

function goToStep(step) {
    // Hide all steps
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));

    // Show current step
    const targetStep = document.getElementById(`wizard-step-${step}`);
    if (targetStep) {
        targetStep.classList.add('active');
    }

    // Toggle buildpack vs dockerfile config visibility when going to step 3
    if (step === 3) {
        selectBuildOption(wizSelectedBuildOption || 'buildpack');
    }

    if (document.body.classList.contains('debug-mode')) {
        setTimeout(updateDebugDimensions, 100);
    }
}

function selectSource(source) {
    wizSelectedSource = source;
    if (source === 'github') {
        goToStep(2);
        loadGithubRepos(); // Auto-load repos using token
    } else {
        // Docker selected - skip to step 4 config with Docker adjustments
        wizSelectedRepo = { full_name: 'docker-image', private: false, isDocker: true };
        document.getElementById('wiz-app-name').value = 'my-docker-service';
        document.getElementById('wiz-branch-group').style.display = 'none'; // Docker doesn't need branches

        // Adjust the service label to ask for docker image instead of github URL
        const parent = document.getElementById('wiz-app-name').parentElement;
        // We will just pre-fill wiz-app-name and add another field for Docker Image if needed.
        // For simplicity, we can let user enter name and then we will customize configuration.
        // Let's go to Step 4 directly.
        resetWizEnvVarsContainer();
        loadWizServers();
        goToStep(4);
    }
}

function selectBuildOption(option) {
    wizSelectedBuildOption = option;
    const bpCard = document.getElementById('buildpack-card');
    const dfCard = document.getElementById('dockerfile-card');
    const bpContainer = document.getElementById('wiz-bp-container');
    const dfContainer = document.getElementById('wiz-df-container');

    if (option === 'buildpack') {
        bpCard.classList.add('active');
        dfCard.classList.remove('active');
        bpContainer.style.display = 'block';
        dfContainer.style.display = 'none';
    } else {
        bpCard.classList.remove('active');
        dfCard.classList.add('active');
        bpContainer.style.display = 'none';
        dfContainer.style.display = 'block';
    }
}

// Collapsible Panel Toggler helper
function toggleCollapsible(id, header) {
    const el = document.getElementById(id);
    const arrow = header.querySelector('.arrow-icon');
    if (el.style.display === 'none' || el.style.display === '') {
        el.style.display = 'block';
        arrow.style.transform = 'rotate(90deg)';
        header.style.borderBottomLeftRadius = '0px';
        header.style.borderBottomRightRadius = '0px';
    } else {
        el.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
        header.style.borderBottomLeftRadius = '12px';
        header.style.borderBottomRightRadius = '12px';
    }
}

// Render dynamic repo list
function renderReposList(repos) {
    const reposList = document.getElementById('github-repos-list');
    if (repos.length === 0) {
        reposList.innerHTML = '<div class="no-data">Heç bir repozitoriya tapılmadı</div>';
        return;
    }

    reposList.innerHTML = repos.map(repo => {
        const isPrivate = repo.private;
        const badgeClass = isPrivate ? 'badge-private' : 'badge-public';
        const badgeText = isPrivate ? 'Private' : 'Public';
        return `
            <div class="repo-list-item" onclick="selectRepo('${repo.full_name}', ${isPrivate})">
                <span style="font-weight: 500; font-family: monospace;">🐱 ${repo.full_name}</span>
                <span class="${badgeClass}">${badgeText}</span>
            </div>
        `;
    }).join('');
}

function filterRepos() {
    const searchVal = document.getElementById('repo-search').value.toLowerCase().trim();
    if (!searchVal) {
        renderReposList(gitHubRepos);
        return;
    }
    const filtered = gitHubRepos.filter(r => r.full_name.toLowerCase().includes(searchVal));
    renderReposList(filtered);
}

// Import public repo manually
function importManualRepo() {
    const url = document.getElementById('manual-public-repo').value.trim();
    if (!url) {
        alert("Lütfən public repository URL-i daxil edin!");
        return;
    }
    if (!url.startsWith('http')) {
        alert("Düzgün bir URL daxil edin (məs. https://github.com/owner/repo)!");
        return;
    }

    // Parse owner/repo name
    let name = url.replace('https://github.com/', '').replace('.git', '');
    wizSelectedRepo = { full_name: name, private: false, manualUrl: url };

    document.getElementById('wiz-app-name').value = name.split('/').pop() || 'public-app';
    document.getElementById('wiz-branch-group').style.display = 'block';

    // Populate default branch select option
    document.getElementById('wiz-app-branch').innerHTML = '<option value="main">main</option><option value="master">master</option>';

    resetWizEnvVarsContainer();
    loadWizServers();
    goToStep(3);
}

async function selectRepo(repoFullName, isPrivate) {
    wizSelectedRepo = { full_name: repoFullName, private: isPrivate };

    // Pre-fill app name
    const appName = repoFullName.split('/').pop();
    document.getElementById('wiz-app-name').value = appName;
    document.getElementById('wiz-branch-group').style.display = 'block';

    // Load branches from GitHub API
    const branchSelect = document.getElementById('wiz-app-branch');
    branchSelect.innerHTML = '<option value="">Budaqlar yüklənir...</option>';

    const token = githubToken;

    try {
        const res = await fetch(`https://api.github.com/repos/${repoFullName}/branches`, {
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
            branchSelect.innerHTML = '<option value="main">main</option><option value="master">master</option>';
        }
    } catch (e) {
        console.error(e);
        branchSelect.innerHTML = '<option value="main">main</option>';
    }

    resetWizEnvVarsContainer();
    loadWizServers();
    goToStep(3);
}

// --- Wizard JS Logic (Modularized in applications.js) ---
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
    const changelog = await fetchChangelog();
    systemVersions = changelog;

    try {
        const vRes = await fetch('/api/version');
        const vData = await vRes.json();
        _currentPanelVersion = vData.version;
        const currentNum = parseVersionNum(_currentPanelVersion);

        let latestVer = '';
        let hasNewer = false;
        if (changelog.length > 0) {
            latestVer = changelog[0].version;
            if (parseVersionNum(latestVer) > currentNum) {
                hasNewer = true;
            }
        }

        // Badge məntiqi — yalnız burada, fetchAppVersion-da deyil
        const badge = document.getElementById('version-badge');
        const versionText = document.getElementById('version-text');
        if (badge) {
            if (hasNewer) {
                badge.innerHTML = `<span onclick="openSystemUpdateModal()" style="background: linear-gradient(135deg, #ff416c, #ff4b2b); color: white; border-radius: 5px; padding: 2px 7px; font-size: 0.52rem; margin-left: 4px; cursor: pointer; font-weight: 700; letter-spacing: 0.5px; box-shadow: 0 2px 8px rgba(255,65,108,0.4); animation: pulse-badge 2s infinite;" title="${latestVer} mövcuddur — klikləyin">UPDATE</span>`;
            } else {
                badge.innerHTML = '';
            }
        }
    } catch (e) { }
}

function openSystemUpdateModal() {
    showModal('system-update-modal');
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
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-weight: 700; font-size: 1rem; color: var(--text-primary); font-family: monospace;">${v.version}</span>
                    ${badgeHtml}
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

// ─── Custom Kart Modal (confirm yerine) ───────────────────────────────────────
function showConfirmCard({ icon, title, subtitle, body, warning, confirmText, confirmStyle, onConfirm }) {
    const modal = document.getElementById('confirm-card-modal');
    document.getElementById('confirm-card-icon').textContent = icon || '❓';
    document.getElementById('confirm-card-title').textContent = title || 'Əminsiniz?';
    document.getElementById('confirm-card-subtitle').textContent = subtitle || '';
    document.getElementById('confirm-card-body').innerHTML = body || '';

    const warnEl = document.getElementById('confirm-card-warning');
    if (warning) {
        warnEl.style.display = 'block';
        warnEl.textContent = warning;
    } else {
        warnEl.style.display = 'none';
    }

    const yesBtn = document.getElementById('confirm-card-yes');
    yesBtn.textContent = confirmText || 'Təsdiqlə';
    yesBtn.style.cssText = `padding: 8px 20px; ${confirmStyle || ''}`;

    modal.style.display = 'flex';

    const close = () => { modal.style.display = 'none'; };
    yesBtn.onclick = () => { close(); onConfirm && onConfirm(); };
    document.getElementById('confirm-card-no').onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
}

function showInfoCard(title, subtitle, body) {
    showConfirmCard({
        icon: 'ℹ️', title, subtitle, body,
        confirmText: 'Bağla',
        confirmStyle: '',
        onConfirm: () => { }
    });
    document.getElementById('confirm-card-no').style.display = 'none';
    setTimeout(() => document.getElementById('confirm-card-no').style.display = '', 100);
}

// ─── Fəaliyyət Jurnalı ─────────────────────────────────────────────────────
const LOG_ICONS = {
    deploy: { icon: '🚀', color: '#00d2ff' },
    update: { icon: '🔄', color: '#7c3aed' },
    server: { icon: '🖥️', color: '#00e676' },
    app: { icon: '📦', color: '#ff9800' },
    error: { icon: '❌', color: '#ff1744' },
    info: { icon: '📋', color: '#9aa0a6' },
    delete: { icon: '🗑️', color: '#ff1744' },
    setup: { icon: '⚙️', color: '#00e676' },
};

async function addActivityLog(message, type = 'info') {
    try {
        await fetch('/api/activity-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, log_type: type })
        });
        renderActivityLogs();
    } catch (e) {
        console.error("Failed to add activity log", e);
    }
}

let currentActivityFilter = 'all';

function filterActivityLogs(filterType) {
    currentActivityFilter = filterType;
    const buttons = document.querySelectorAll('.activity-tab-btn');
    buttons.forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes(`'${filterType}'`)) {
            btn.classList.add('active');
            btn.style.color = 'var(--text-primary)';
            btn.style.borderColor = 'var(--primary-color)';
        } else {
            btn.classList.remove('active');
            btn.style.color = 'var(--text-secondary)';
            btn.style.borderColor = 'var(--card-border)';
        }
    });
    renderActivityLogs();
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

function toggleGithubTokenVisibility(event) {
    if (event) event.stopPropagation();
    const input = document.getElementById('gh-token');
    const btn = event.currentTarget;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
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
    showInfoCard('Kopyalandı', '', 'Loq uğurla kopyalandı.');
}

let activeActivityLogs = [];

async function copyCurrentSectionLogs() {
    try {
        const res = await fetch('/api/activity-logs');
        if (res.ok) {
            const logs = await res.json();
            let filteredLogs = logs;
            if (currentActivityFilter === 'masterdeploy') {
                filteredLogs = logs.filter(l => l.message.includes('[Yenilənmə]') || l.message.includes('[Sistem]') || l.log_type === 'system');
            } else if (currentActivityFilter === 'apps') {
                filteredLogs = logs.filter(l => l.message.includes('[Auto-Deploy]') || l.message.includes('[Auto-Deploy Xətası]') || l.log_type === 'app' || l.log_type === 'delete' || l.log_type === 'setup' || l.message.toLowerCase().includes('layihə'));
            } else if (currentActivityFilter === 'servers') {
                filteredLogs = logs.filter(l => l.log_type === 'server' || l.message.toLowerCase().includes('server'));
            }
            
            const textToCopy = filteredLogs.map(l => `[${l.created_at}] ${l.message}`).join('\n');
            copyToClipboard(textToCopy);
            showInfoCard('Kopyalandı', '', 'Bölmədəki bütün loqlar buferə kopyalandı.');
        }
    } catch (e) {
        console.error("Failed to copy section logs", e);
    }
}

function showLogDetailsByIndex(index) {
    const l = activeActivityLogs[index];
    if (!l) return;
    showLogDetails(l.message, l.log_type, l.created_at);
}

function showLogDetails(message, logType, createdAt) {
    const meta = document.getElementById('log-detail-meta');
    const text = document.getElementById('log-detail-text');
    const extraSection = document.getElementById('log-detail-extra-section');
    const extraTerminal = document.getElementById('log-detail-extra-terminal');
    const viewDeployBtn = document.getElementById('log-detail-view-deploy-btn');
    
    meta.textContent = `${logType.toUpperCase()} | ${createdAt}`;
    text.value = message;
    
    extraSection.style.display = 'none';
    viewDeployBtn.style.display = 'none';
    
    const appMatch = message.match(/'([^']+)'/);
    let appName = null;
    let foundApp = null;
    if (appMatch) {
        appName = appMatch[1];
        if (Array.isArray(globalApps)) {
            foundApp = globalApps.find(a => a.name === appName);
        }
    }
    
    if (appName && deletionLogsCache[appName]) {
        extraSection.style.display = 'flex';
        document.getElementById('log-detail-extra-title').textContent = 'Silinmə Prosesi Loqları:';
        extraTerminal.textContent = deletionLogsCache[appName].join('\n');
    }
    
    if (foundApp && (message.toLowerCase().includes('yenilənmə') || message.toLowerCase().includes('deploy') || message.toLowerCase().includes('manifest') || message.toLowerCase().includes('commit') || message.toLowerCase().includes('xətası'))) {
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

async function renderActivityLogs() {
    const container = document.getElementById('activity-log-list');
    if (!container) return;
    try {
        const res = await fetch('/api/activity-logs');
        if (res.ok) {
            const logs = await res.json();
            
            // Filtrləmə məntiqi
            let filteredLogs = logs;
            if (currentActivityFilter === 'masterdeploy') {
                filteredLogs = logs.filter(l => l.message.includes('[Yenilənmə]') || l.message.includes('[Sistem]') || l.log_type === 'system');
            } else if (currentActivityFilter === 'apps') {
                filteredLogs = logs.filter(l => l.message.includes('[Auto-Deploy]') || l.message.includes('[Auto-Deploy Xətası]') || l.log_type === 'app' || l.log_type === 'delete' || l.log_type === 'setup' || l.message.toLowerCase().includes('layihə'));
            } else if (currentActivityFilter === 'servers') {
                filteredLogs = logs.filter(l => l.log_type === 'server' || l.message.toLowerCase().includes('server'));
            }

            activeActivityLogs = filteredLogs;

            if (filteredLogs.length === 0) {
                container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-secondary); text-align: center; padding: 20px; opacity: 0.5;">Hərəkət qeydə alınmayıb</div>';
                return;
            }
            container.innerHTML = filteredLogs.map((l, i) => {
                const meta = LOG_ICONS[l.log_type] || LOG_ICONS.info;
                let timeStr = '--:--';
                if (l.created_at) {
                    try {
                        const isoStr = l.created_at.trim().replace(" ", "T") + "Z";
                        const localDate = new Date(isoStr);
                        const h = String(localDate.getHours()).padStart(2, '0');
                        const m = String(localDate.getMinutes()).padStart(2, '0');
                        timeStr = `${h}:${m}`;
                    } catch (e) {
                        timeStr = l.created_at;
                    }
                }
                const escapedMessage = escapeHtml(l.message);
                return `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border-radius:10px; background:rgba(255,255,255,0.02); border: 1px solid var(--card-border); margin-bottom: 2px;">
                    <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1; cursor:pointer;" onclick="showLogDetailsByIndex(${i})">
                        <span style="font-size:1.1rem; flex-shrink:0; display:flex; align-items:center; justify-content:center; width:28px; height:28px; background:rgba(255,255,255,0.03); border-radius:8px;">${meta.icon}</span>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.82rem; color:var(--text-primary); font-weight:500; overflow:hidden; text-overflow:ellipsis;" title="Detalları görmək üçün klikləyin">${l.message}</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                        <button onclick="copySingleLog(event, '${escapedMessage}')" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; font-size:0.95rem; padding:4px 6px; border-radius:4px; transition:color 0.2s;" onmouseover="this.style.color='var(--accent-color)'" onmouseout="this.style.color='var(--text-secondary)'" title="Kopyala">📋</button>
                        <span style="font-size:0.75rem; color:var(--text-secondary); font-family:monospace; opacity:0.8;">${timeStr}</span>
                    </div>
                </div>`;
            }).join('');
        }
    } catch (e) {
        console.error("Failed to render activity logs", e);
    }
}

async function clearActivityLogs() {
    try {
        const res = await fetch('/api/activity-logs', { method: 'DELETE' });
        if (res.ok) {
            renderActivityLogs();
        }
    } catch (e) {
        console.error("Failed to clear activity logs", e);
    }
}

async function openHelpCenter() {
    showModal('help-modal');
    switchHelpTab('help-changelog');

    const clog = document.getElementById('help-changelog');
    clog.innerHTML = 'Yüklənir...';
    if (systemVersions.length === 0) systemVersions = await fetchChangelog();
    clog.innerHTML = systemVersions.map(v => `<div style="margin-bottom: 20px;">
        <h3 style="margin-bottom:10px; color:var(--primary-color);">${v.version}</h3>
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

// --- App Deployments JS Logic (Modularized in applications.js) ---

function toggleDebugMode() {
    document.body.classList.toggle('debug-mode');
    const isDebug = document.body.classList.contains('debug-mode');
    localStorage.setItem('debug_mode', isDebug ? 'true' : 'false');
    if (isDebug) {
        if (typeof initDebugTooltips === 'function') initDebugTooltips();
    } else {
        if (typeof removeDebugTooltips === 'function') removeDebugTooltips();
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
    if (isDebug) {
        document.body.classList.add('debug-mode');
        setTimeout(initDebugTooltips, 500);
    }
});

// Hook dynamic rendering (Moved to applications.js)
// --- App Re-declarations JS Logic (Modularized in applications.js) ---
// --- Cloudflare Worker JS Logic (Modularized in applications.js) ---
function handleServerKeySelect(selectId, wrapperId) {
    const select = document.getElementById(selectId);
    const wrapper = document.getElementById(wrapperId);
    if (!select || !wrapper) return;

    if (select.value && select.value !== "") {
        wrapper.style.display = 'none';
        const textarea = wrapper.querySelector('textarea');
        if (textarea) textarea.removeAttribute('required');
    } else {
        wrapper.style.display = 'block';
        const textarea = wrapper.querySelector('textarea');
        if (textarea && selectId !== 'edit-srv-key-id') textarea.setAttribute('required', 'true');
    }
}

// --- Auto Local SSH Key Loader ---
async function loadLocalSshKey() {
    try {
        const res = await fetch('/api/system/local-ssh-key');
        if (res.ok) {
            const data = await res.json();
            const valInput = document.getElementById('local-ssh-public-key-value');
            if (valInput && data.public_key) {
                valInput.value = data.public_key;
                
                // Həmçinin maskalanmış span-ı doldururuq
                const maskEl = document.getElementById('coolify-local-key-mask');
                if (maskEl) {
                    maskEl.innerText = '••••••••••••••••••••••••••••••••••••••••••••••••••';
                }
            }
        }
    } catch (e) {
        console.error("Local SSH key load failed", e);
    }
}

function copyLocalSshKey(btn) {
    const textEl = document.getElementById('local-ssh-public-key');
    if (!textEl) return;
    navigator.clipboard.writeText(textEl.value).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '✅ Kopyalandı';
        btn.style.background = 'var(--success-color)';
        setTimeout(() => {
            btn.innerHTML = orig;
            btn.style.background = 'var(--btn-primary-bg, #7c3aed)';
        }, 2000);
    }).catch(err => {
        showToast('Kopyalamak mümkün olmadı: ' + err, 'error');
    });
}

// --- Pane GitHub Token Logic ---
async function loadPaneGithubToken() {
    try {
        const res = await fetch('/api/settings/github-token');
        if (res.ok) {
            const data = await res.json();
            const input = document.getElementById('pane-gh-token');
            if (input && data.token) {
                input.value = data.token;
                checkPaneGithubConnection(data.token);
            } else {
                updatePaneGithubConnectionStatus('incomplete');
            }
        }
    } catch (e) {
        updatePaneGithubConnectionStatus('error');
    }
}

async function savePaneGithubToken() {
    const token = document.getElementById('pane-gh-token').value.trim();
    try {
        const res = await fetch('/api/settings/github-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        if (res.ok) {
            showToast('GitHub Token yeniləndi!', 'success');
            githubToken = token; // sync global var
            checkPaneGithubConnection(token);
        } else {
            showToast('Token yadda saxlanıla bilmədi.', 'error');
        }
    } catch (e) {
        showToast('Qoşulma xətası: ' + e.message, 'error');
    }
}

async function checkPaneGithubConnection(token) {
    const statusEl = document.getElementById('pane-gh-status');
    if (!statusEl) return;

    if (!token || token === '') {
        updatePaneGithubConnectionStatus('incomplete');
        return;
    }

    statusEl.innerText = 'Yoxlanılır... ⏳';
    statusEl.style.color = '#ff9800';

    try {
        const res = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `token ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            updatePaneGithubConnectionStatus('connected', user.login);
        } else {
            updatePaneGithubConnectionStatus('invalid');
        }
    } catch (e) {
        updatePaneGithubConnectionStatus('error');
    }
}

function updatePaneGithubConnectionStatus(status, username = '') {
    const statusEl = document.getElementById('pane-gh-status');
    const badgeStatus = document.getElementById('coolify-github-token-status-badge');
    const apiBadgeCount = document.getElementById('subtab-badge-api');
    
    if (apiBadgeCount) {
        // Hələlik 1 ədəd GitHub PAT tokenimiz var deyə 1 qeyd edirik
        apiBadgeCount.innerText = "1";
    }

    if (!statusEl) return;

    if (status === 'connected') {
        statusEl.innerText = `Bağlantı aktivdir (İstifadəçi: ${username}) 🟢`;
        statusEl.style.color = '#00e676';
        if (badgeStatus) {
            badgeStatus.innerText = 'Active';
            badgeStatus.style.background = 'rgba(46, 204, 113, 0.1)';
            badgeStatus.style.color = '#2ecc71';
        }
    } else if (status === 'incomplete') {
        statusEl.innerText = 'Token quraşdırılmayıb 🟡';
        statusEl.style.color = '#ffb86c';
        if (badgeStatus) {
            badgeStatus.innerText = 'Incomplete';
            badgeStatus.style.background = 'rgba(255, 184, 108, 0.1)';
            badgeStatus.style.color = '#ffb86c';
        }
    } else if (status === 'invalid') {
        statusEl.innerText = 'Yanlış Token 🔴';
        statusEl.style.color = '#ff5555';
        if (badgeStatus) {
            badgeStatus.innerText = 'Invalid';
            badgeStatus.style.background = 'rgba(255, 85, 85, 0.1)';
            badgeStatus.style.color = '#ff5555';
        }
    } else {
        statusEl.innerText = 'Şəbəkə xətası 🔴';
        statusEl.style.color = '#ff5555';
        if (badgeStatus) {
            badgeStatus.innerText = 'Error';
            badgeStatus.style.background = 'rgba(255, 85, 85, 0.1)';
            badgeStatus.style.color = '#ff5555';
        }
    }
}

function togglePaneGithubTokenVisibility(e) {
    e.preventDefault();
    const input = document.getElementById('pane-gh-token');
    const btn = event.target;
    if (input) {
        if (input.type === 'password') {
            input.type = 'text';
            btn.innerText = '🔒';
        } else {
            input.type = 'password';
            btn.innerText = '👁️';
        }
    }
}

function toggleLocalSshKeyVisibility(e) {
    e.preventDefault();
    const input = document.getElementById('local-ssh-public-key');
    const btn = event.target;
    if (input) {
        if (input.type === 'password') {
            input.type = 'text';
            btn.innerText = '🔒';
        } else {
            input.type = 'password';
            btn.innerText = '👁️';
        }
    }
}

// --- Coolify Card Detail Expander & Security Masking ---
function toggleCardDetail(headerEl) {
    const card = headerEl.closest('.item-card');
    if (!card) return;
    const details = card.querySelector('.card-details');
    const chevron = card.querySelector('.chevron-icon');
    
    if (details) {
        const isHidden = details.classList.contains('hidden');
        if (isHidden) {
            details.classList.remove('hidden');
            details.style.display = 'flex';
            if (chevron) {
                chevron.innerText = '▲';
                chevron.style.transform = 'rotate(180deg)';
            }
        } else {
            details.classList.add('hidden');
            details.style.display = 'none';
            if (chevron) {
                chevron.innerText = '▼';
                chevron.style.transform = 'rotate(0deg)';
            }
        }
    }
}

function toggleShowPrivateKey(btn, fullValue) {
    const container = btn.previousElementSibling;
    if (!container) return;
    
    const isMasked = btn.getAttribute('data-masked') !== 'false';
    
    if (isMasked) {
        container.innerText = fullValue;
        container.style.whiteSpace = 'pre-wrap';
        container.style.overflow = 'visible';
        btn.innerText = 'Gizlət';
        btn.setAttribute('data-masked', 'false');
    } else {
        container.innerText = '••••••••••••••••••••••••••••••••••••••••••••••••••';
        container.style.whiteSpace = 'nowrap';
        container.style.overflow = 'hidden';
        btn.innerText = 'Göstər';
        btn.setAttribute('data-masked', 'true');
    }
}

function copyTextToClipboard(text, label) {
    navigator.clipboard.writeText(text).then(() => {
        showToast(`"${label}" müvəffəqiyyətlə kopyalandı!`, 'success');
    }).catch(err => {
        showToast('Kopyalamaq mümkün olmadı: ' + err, 'error');
    });
}

// --- Keys & Tokens Modular UI Async Loader ---
async function loadKeysTokensModularUI() {
    const root = document.getElementById('keys-tokens-modular-root');
    if (!root) return;
    
    if (isKeysTokensUILoaded && root.querySelector('.keys-tokens-container')) return;
    if (isKeysTokensUILoading) return;
    isKeysTokensUILoading = true;
    
    try {
        // Cache busting əlavə edirik (?t=...)
        const res = await fetch('keys_tokens.html?t=' + Date.now());
        if (res.ok) {
            const html = await res.text();
            root.innerHTML = html;
            isKeysTokensUILoaded = true;

            // keys_tokens.js skriptini zəmanətli və cache busting ilə yükləyirik
            if (!document.getElementById('keys-tokens-script')) {
                const script = document.createElement('script');
                script.id = 'keys-tokens-script';
                script.src = '/keys_tokens.js?t=' + Date.now();
                script.onload = () => {
                    if (typeof initKeysTokens === 'function') {
                        initKeysTokens();
                    }
                };
                document.body.appendChild(script);
            } else {
                if (typeof initKeysTokens === 'function') {
                    initKeysTokens();
                }
            }
        }
    } catch (e) {
        console.error("Keys & Tokens modulunu yükləmək mümkün olmadı", e);
        root.innerHTML = `<div style="color:var(--danger-color); padding: 1rem;">Modul yüklənməsində xəta baş verdi.</div>`;
    } finally {
        isKeysTokensUILoading = false;
    }
}

// --- Servers Modular UI Async Loader ---
async function loadServersModularUI() {
    const root = document.getElementById('servers-modular-root');
    if (!root) return;

    if (isServersUILoaded && root.querySelector('#servers-list')) {
        if (typeof window.loadServers === 'function') {
            window.loadServers();
        }
        return;
    }
    if (isServersUILoading) return;
    isServersUILoading = true;

    try {
        const res = await fetch('servers.html?t=' + Date.now());
        if (res.ok) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = await res.text();

            const serversSec = tempDiv.querySelector('#tab-servers');
            const modallat = tempDiv.querySelectorAll('.modal-backdrop');

            if (serversSec) {
                root.innerHTML = serversSec.innerHTML;
            } else {
                root.innerHTML = tempDiv.innerHTML;
            }

            modallat.forEach(m => {
                const existing = document.getElementById(m.id);
                if (existing) existing.remove();
                document.body.appendChild(m);
            });

            isServersUILoaded = true;

            if (!document.getElementById('servers-script')) {
                const script = document.createElement('script');
                script.id = 'servers-script';
                script.src = '/servers.js?t=' + Date.now();
                script.onload = () => {
                    if (typeof window.loadServers === 'function') {
                        window.loadServers();
                    }
                };
                document.body.appendChild(script);
            } else {
                if (typeof window.loadServers === 'function') {
                    window.loadServers();
                }
            }
        }
    } catch (e) {
        console.error("Serverlər modulunu yükləmək mümkün olmadı", e);
        root.innerHTML = `<div style="color:var(--danger-color); padding: 1rem;">Modul yüklənməsində xəta baş verdi.</div>`;
    } finally {
        isServersUILoading = false;
    }
}

// --- Applications Modular UI Async Loader ---
async function loadApplicationsModularUI() {
    const root = document.getElementById('applications-modular-root');
    const detailsRoot = document.getElementById('app-details-modular-root');
    if (!root) return;

    if (isApplicationsUILoaded && root.querySelector('#apps-list')) return;
    if (isApplicationsUILoading) return;
    isApplicationsUILoading = true;

    try {
        const res = await fetch('applications.html?t=' + Date.now());
        if (res.ok) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = await res.text();
            
            // Extract the sections and overlays
            const appsSec = tempDiv.querySelector('#tab-applications');
            const detailsSec = tempDiv.querySelector('#tab-app-details');
            const overlays = tempDiv.querySelectorAll('.app-overlay, .modal-backdrop');
            
            if (appsSec) root.innerHTML = appsSec.innerHTML;
            if (detailsSec && detailsRoot) detailsRoot.innerHTML = detailsSec.innerHTML;
            
            // Append overlays to document body
            overlays.forEach(overlay => {
                const existing = document.getElementById(overlay.id);
                if (existing) existing.remove();
                document.body.appendChild(overlay);
            });

            isApplicationsUILoaded = true;

            if (!document.getElementById('applications-script')) {
                const script = document.createElement('script');
                script.id = 'applications-script';
                script.src = '/applications.js?t=' + Date.now();
                script.onload = () => {
                    if (typeof loadApplications === 'function') {
                        loadApplications();
                    }
                };
                document.body.appendChild(script);
            } else {
                if (typeof loadApplications === 'function') {
                    loadApplications();
                }
            }
        }
    } catch (e) {
        console.error("Layihələr modulunu yükləmək mümkün olmadı", e);
        root.innerHTML = `<div style="color:var(--danger-color); padding: 1rem;">Modul yüklənməsində xəta baş verdi.</div>`;
    } finally {
        isApplicationsUILoading = false;
    }
}
