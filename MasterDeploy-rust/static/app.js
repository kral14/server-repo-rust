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

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    loadServers();
    if (typeof initKeysTokens === 'function') initKeysTokens();
    loadApplications();
    loadGithubToken();
    resetEnvVarsContainer();
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

    // Restore active tab immediately
    const activeTab = localStorage.getItem('active_tab') || 'dashboard';
    if (activeTab === 'app-details') {
        const appId = localStorage.getItem('active_app_id');
        if (appId) {
            currentAppDetailsId = appId;
            const subTab = localStorage.getItem('active_app_subtab') || 'overview';
            switchTab('app-details');
            switchAppTab(subTab);
            openAppDetails(appId, false);
        } else {
            switchTab('applications');
        }
    } else {
        switchTab(activeTab);
    }

    // Səhifə yenilənəndə əvvəl açıq olan bütün pəncərələri avtomatik bərpa edirik
    setTimeout(restoreDesktopWindowsState, 150);

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
    'rsa-result-modal': '🔑 RSA Açar Cütü',
    'kt-rsa-overlay': '🔐 RSA 4096-bit Açar',
    'kt-ssh-overlay': '🔑 Yeni SSH Açarı',
    'kt-edit-ssh-overlay': '✏️ SSH Açarı Redaktə'
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

// Səhifə yenilənəndə bütün açıq və kiçildilmiş pəncərələrin statusunu yadda saxla
function saveActiveWindowsState() {
    try {
        const state = {
            active: Object.keys(activeWindows),
            minimized: Object.keys(minimizedWindows),
            maximized: Object.keys(activeWindows).filter(id => {
                const b = document.getElementById(id);
                const c = b ? b.querySelector('.modal-card') : null;
                return c && c.classList.contains('maximized');
            })
        };
        localStorage.setItem('desktop_windows_state', JSON.stringify(state));
    } catch (e) {
        console.error("Failed to save windows state", e);
    }
}

// Səhifə yeniləndikdə əvvəl açıq olan bütün pəncərələri avtomatik aç və bərpa et
function restoreDesktopWindowsState() {
    try {
        const raw = localStorage.getItem('desktop_windows_state');
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state || !Array.isArray(state.active) || state.active.length === 0) return;

        state.active.forEach(winId => {
            const backdrop = document.getElementById(winId);
            if (backdrop) {
                showModal(winId);
                if (state.maximized && state.maximized.includes(winId)) {
                    maximizeWindow(winId);
                }
                if (state.minimized && state.minimized.includes(winId)) {
                    minimizeWindow(winId);
                }
            }
        });
    } catch (e) {
        console.error("Failed to restore desktop windows", e);
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
    const card = backdrop.querySelector('.modal-card, .kt-overlay-card');

    maxZIndex++;
    if (card) card.style.zIndex = maxZIndex;
    backdrop.style.zIndex = maxZIndex;
}

function minimizeWindow(windowId) {
    const backdrop = document.getElementById(windowId);
    if (!backdrop) return;
    backdrop.classList.add('minimized');
    minimizedWindows[windowId] = true;
    saveActiveWindowsState();
    updateTaskbar();
}

function restoreWindow(windowId) {
    const backdrop = document.getElementById(windowId);
    if (!backdrop) return;
    backdrop.classList.remove('minimized');
    if (windowId.startsWith('kt-')) {
        backdrop.style.display = 'flex';
    }
    bringToFront(windowId);
    delete minimizedWindows[windowId];
    saveActiveWindowsState();
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
    saveActiveWindowsState();
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
    saveActiveWindowsState();
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

    activeWindows[id] = true;
    delete minimizedWindows[id];
    saveActiveWindowsState();

    if (id === 'activity-log-modal') {
        if (typeof startLiveActivityMonitor === 'function') {
            startLiveActivityMonitor();
        }
    }

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
    saveActiveWindowsState();

    if (id === 'logs-modal') {
        stopLogPolling();
    }
    if (id === 'activity-log-modal') {
        if (typeof stopLiveActivityMonitor === 'function') {
            stopLiveActivityMonitor();
        }
    }

    updateTaskbar();
}

// Load servers from Rust API
async function loadServers() {
    try {
        const res = await fetch('/api/servers');
        const servers = await res.json();

        const serversList = document.getElementById('servers-list');
        const serverSelect = document.getElementById('app-server');

        document.getElementById('stat-servers-count').innerText = servers.length;

        if (servers.length === 0) {
            serversList.innerHTML = `<div class="no-data">Hələ heç bir server əlavə edilməyib.</div>`;
            serverSelect.innerHTML = `<option value="">Öncə server əlavə edin</option>`;
            return;
        }

        const currentServerOptionsHash = servers.map(s => s.id).join(',');
        if (serverSelect.getAttribute('data-options-hash') !== currentServerOptionsHash) {
            serverSelect.setAttribute('data-options-hash', currentServerOptionsHash);
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

        const serversHash = JSON.stringify(servers.map(s => `${s.id}_${s.name}_${s.ip}_${s.ssh_user}`));
        if (serversList.getAttribute('data-render-hash') !== serversHash) {
            serversList.setAttribute('data-render-hash', serversHash);
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
        }

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
                        <td style="padding: 8px 4px; font-family: monospace; font-weight: bold; color: var(--accent-color);">
                            ${c.size}
                        </td>
                    </tr>
                `;
            });
            contsTableHtml += '</tbody></table>';
        }
        contsTableHtml += '</div>';

        container.innerHTML = diskBannerHtml + tabsHtml + volsTableHtml + contsTableHtml;

    } catch (e) {
        container.innerHTML = `<div style="color:#ff1744; padding: 10px;">Qoşulma xətası: ${e.message}</div>`;
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
async function loadApplications() {
    try {
        // Layihələri çəkməzdən əvvəl plugin statuslarını alırıq ki, installedPlugins dolsun
        try {
            const pRes = await fetch('/api/plugins');
            const plugins = await pRes.json();
            if (Array.isArray(plugins)) {
                plugins.forEach(p => {
                    installedPlugins[p.id] = p.installed;
                });
            }
        } catch (e) {
            console.error("Plugins fetch failed", e);
        }

        const [appRes, srvRes] = await Promise.all([
            fetch('/api/applications'),
            fetch('/api/servers')
        ]);

        let apps = [];
        if (appRes.ok) {
            try {
                apps = await appRes.json();
            } catch (err) {
                console.error("Failed to parse applications JSON:", err);
            }
        } else {
            console.warn("Failed to load applications, status:", appRes.status);
        }
        globalApps = Array.isArray(apps) ? apps : [];

        let servers = [];
        if (srvRes.ok) {
            try {
                servers = await srvRes.json();
            } catch (err) {
                console.error("Failed to parse servers JSON:", err);
            }
        } else {
            console.warn("Failed to load servers, status:", srvRes.status);
        }
        if (!Array.isArray(servers)) servers = [];

        const serverMap = {};
        const serverObjects = {};
        servers.forEach(s => {
            serverMap[s.id] = s.ip;
            serverObjects[s.id] = s;
        });

        const appsList = document.getElementById('apps-list');
        document.getElementById('stat-apps-count').innerText = globalApps.length;

        if (apps.length === 0) {
            appsList.innerHTML = `<div class="no-data">Hələ heç bir layihə əlavə edilməyib.</div>`;
            return;
        }

        // Group apps by server_id
        const groupedApps = {};
        apps.forEach(app => {
            const sid = app.server_id || 'unknown';
            if (!groupedApps[sid]) {
                groupedApps[sid] = [];
            }
            groupedApps[sid].push(app);
        });

        let html = '';
        for (const sid of Object.keys(groupedApps)) {
            const srv = serverObjects[sid];
            if (!srv) {
                // If server is deleted or does not exist in servers list, do not render its applications
                continue;
            }
            const srvName = srv.name;
            const srvIp = srv.ip;

            // Server Header
            html += `
            <div class="server-group" data-server-id="${sid}">
                <div class="server-group-header">
                    <h3>
                        🖥️ ${srvName} <span class="ip">(${srvIp})</span>
                    </h3>
                    <div class="server-group-header-info">
                        <span class="server-stats-badge" id="srv-stats-cpu-${sid}">
                            CPU: <strong>--</strong>
                        </span>
                        <span class="server-stats-badge" id="srv-stats-ram-${sid}">
                            RAM: <strong>-- / -- MB</strong>
                        </span>
                        <div class="server-header-actions">
                            <span class="server-action-link" onclick="goToServerSettings('${sid}')">⚙️ Sazlamalar</span>
                        </div>
                    </div>
                </div>
                <div class="server-apps-list" style="display:flex; flex-direction:column; gap:6px;">
            `;

            // Apps under this server
            groupedApps[sid].forEach(app => {
                const shortUrl = (app.repo_url || '').replace('https://github.com/', '').replace('https://', '');
                const statusColors = {
                    'running': '#00e676', 'success': '#00e676',
                    'failed': '#ff1744', 'deploying': '#00d2ff',
                    'building': '#00d2ff', 'cancelled': '#ff9800', 'idle': '#9aa0a6'
                };
                const sc = statusColors[app.status] || '#9aa0a6';
                const apiLink = `http://${srvIp}:${app.port}`;

                const cached = serverStatsCache[sid];
                let cpuVal = '0%';
                let memVal = '0MB';
                if (cached && cached.containers && cached.containers[app.name]) {
                    const cstats = cached.containers[app.name];
                    cpuVal = cstats.cpu;
                    memVal = cstats.memory;
                }

                const appStatsHtml = `
                <span class="app-load-badge" data-app-name="${app.name}" id="app-load-${app.id}">
                    ⚡ CPU: <strong>${cpuVal}</strong> | 💾 RAM: <strong>${memVal}</strong>
                </span>
                `;


                const isCfInstalled = installedPlugins['cloudflare'] || false;

                html += `
                <div class="list-item" onclick="openAppDetails('${app.id}')" style="cursor: pointer; transition: all 0.2s ease; position: relative;">
                    <div class="item-info" style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1; min-width: 0;">
                            <h3 style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                <span style="display: inline-block; width: 200px; min-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${app.name}">🚀 ${app.name}</span>
                                ${app.status === 'success' || app.status === 'running' ? `
                                <a href="${apiLink}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: var(--accent-color); text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(0, 210, 255, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;">
                                    🔗 Lokal Keçid
                                </a>
                                ${app.cloudflare_url ? `
                                <a href="${app.cloudflare_url}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: #ff9800; text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(255, 152, 0, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;">
                                    ☁️ Cloudflare Keçidi
                                </a>
                                ` : ''}
                                ${app.cf_worker_url ? `
                                <a href="${app.cf_worker_url}" target="_blank" onclick="event.stopPropagation()" style="font-size: 0.75rem; color: #00e676; text-decoration: none; padding: 0.2rem 0.5rem; background: rgba(0, 230, 118, 0.1); border-radius: 4px; display: inline-flex; align-items: center; gap: 0.3rem;" title="Sabit Worker Linki">
                                    🟢 Worker Linki
                                </a>
                                ` : ''}
                                ${isCfInstalled ? `
                                <button onclick="generateCloudflareTunnel(event, '${app.id}')" style="font-size: 0.75rem; color: #fff; background: #e67e22; border: none; border-radius: 4px; padding: 0.2rem 0.5rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem;" title="Cloudflare Tunelini İşə Sal / Link Al">
                                    🔄 ☁️ Tunnel Al
                                </button>
                                ` : ''}
                                ` : ''}
                                ${appStatsHtml}
                            </h3>
                            <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary); display: flex; gap: 1rem; align-items: center;">
                                <span style="max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${app.repo_url}">🐱 ${shortUrl} (${app.branch})</span>
                                <span>🔌 Port: <strong>${app.port}</strong></span>
                            </p>
                        </div>
                        <div style="display:flex; align-items:center; gap:0.8rem;">
                            <div style="display:inline-flex; align-items:center; gap:0.5rem; background: rgba(255,255,255,0.05); padding: 0.4rem 0.8rem; border-radius: 8px;">
                                <span style="width:8px; height:8px; border-radius:50%; background:${sc}; display:inline-block; box-shadow: 0 0 5px ${sc};"></span>
                                <span style="color:${sc}; font-weight:500;">${app.status.toUpperCase()}</span>
                            </div>
                            
                            <!-- 3 xətt menyusu -->
                            <div style="position: relative;">
                                <button class="app-menu-btn" onclick="toggleAppMenu(event, '${app.id}')">⋮</button>
                                <div id="app-menu-${app.id}" class="app-dropdown-menu">
                                    <button onclick="event.stopPropagation(); openAppDetails('${app.id}')">👁️ Detallara Bax</button>
                                    <button class="danger" onclick="handleDeleteAppClick(event, '${app.id}', '${encodeURIComponent(app.name || 'Adsız Layihə')}')">🗑️ Sil</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                `;
            });

            html += `
                </div>
            </div>
            `;
        }

        const renderHash = JSON.stringify(apps.map(a => `${a.id}_${a.name}_${a.status}_${a.port}_${a.server_id}_${a.cloudflare_url}_${a.cf_worker_url}`));
        if (appsList.getAttribute('data-render-hash') !== renderHash) {
            appsList.setAttribute('data-render-hash', renderHash);
            appsList.innerHTML = html;
        }

        // Immediately update stats UI with cache if populated
        updateStatsUI(servers);

        if (document.body.classList.contains('debug-mode')) {
            updateDebugDimensions();
        }
    } catch (e) {
        console.error("Failed to load applications", e);
    }
}


// Handle server creation
async function handleCreateServer(event) {
    event.preventDefault();
    const payload = {
        name: document.getElementById('srv-name').value,
        ip: document.getElementById('srv-ip').value,
        ssh_user: document.getElementById('srv-user').value,
        ssh_key: document.getElementById('srv-key').value,
        ssh_key_id: document.getElementById('srv-key-id').value || null,
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

        document.getElementById('edit-srv-id').value = server.id;
        document.getElementById('edit-srv-name').value = server.name;
        document.getElementById('edit-srv-ip').value = server.ip;
        document.getElementById('edit-srv-user').value = server.ssh_user;
        document.getElementById('edit-srv-key').value = server.ssh_key;

        // Dropdown-da mövcud açarı seçili edirik
        await loadSshKeysDropdown('edit-srv-key-id', server.ssh_key_id);

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
    const payload = {
        name: document.getElementById('edit-srv-name').value,
        ip: document.getElementById('edit-srv-ip').value,
        ssh_user: document.getElementById('edit-srv-user').value,
        ssh_key: document.getElementById('edit-srv-key').value,
        ssh_key_id: document.getElementById('edit-srv-key-id').value || null,
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

function toggleRepoSource(mode) {
    activeSourceMode = mode;
    const manualBtn = document.getElementById('src-manual-btn');
    const githubBtn = document.getElementById('src-github-btn');
    const manualInputs = document.getElementById('git-manual-inputs');
    const githubInputs = document.getElementById('git-github-inputs');

    if (mode === 'manual') {
        manualBtn.classList.add('active');
        githubBtn.classList.remove('active');
        manualInputs.style.display = 'block';
        githubInputs.style.display = 'none';
        document.getElementById('app-repo').required = true;
        document.getElementById('app-branch').required = true;
    } else {
        manualBtn.classList.remove('active');
        githubBtn.classList.add('active');
        manualInputs.style.display = 'none';
        githubInputs.style.display = 'block';
        document.getElementById('app-repo').required = false;
        document.getElementById('app-branch').required = false;

        const token = githubToken;
        if (token && gitHubRepos.length === 0) {
            loadGithubRepos();
        }
    }
}

// Handle application creation
async function handleCreateApp(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const modal = document.getElementById('app-modal');
    if (modal && (modal.style.display === 'none' || modal.classList.contains('minimized'))) {
        return;
    }

    const nameEl = document.getElementById('app-name');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
        showToast('Zəhmət olmasa Layihə Adını (Service Name) daxil edin.', 'warning');
        if (nameEl) nameEl.focus();
        return;
    }

    const deployType = document.getElementById('app-deploy-type').value;
    const registryImage = document.getElementById('app-registry-image').value.trim();
    let repoUrl = "";
    let branch = "";

    if (deployType === 'git') {
        if (activeSourceMode === 'manual') {
            repoUrl = document.getElementById('app-repo').value.trim();
            branch = document.getElementById('app-branch').value.trim();
        } else {
            const repoSelect = document.getElementById('app-repo-select');
            const selectedRepoName = repoSelect.value; // e.g. "owner/repo"
            if (!selectedRepoName) {
                alert("Lütfən bir repozitoriya seçin!");
                return;
            }

            branch = document.getElementById('app-branch-select').value;
            const token = githubToken;

            // Check if the selected repo is private
            const selectedOption = repoSelect.options[repoSelect.selectedIndex];
            const isPrivate = selectedOption.getAttribute('data-private') === 'true';

            if (isPrivate && token) {
                repoUrl = `https://${token}@github.com/${selectedRepoName}.git`;
            } else {
                repoUrl = `https://github.com/${selectedRepoName}.git`;
            }
        }
    }

    const keys = document.querySelectorAll('.env-key');
    const values = document.querySelectorAll('.env-value');
    let envVarsList = [];
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i].value.trim();
        const v = values[i].value.trim();
        if (k) {
            envVarsList.push(`${k}=${v}`);
        }
    }
    const envVarsString = envVarsList.join('\n');

    const server_id = document.getElementById('app-server').value;
    if (!server_id) {
        alert("Əvvəlcə 'Serverlər' bölməsindən server əlavə etməlisiniz!");
        return;
    }

    const memoryLimit = document.getElementById('app-memory').value.trim();
    const cpuLimit = document.getElementById('app-cpu').value.trim();

    const payload = {
        name: document.getElementById('app-name').value.trim(),
        repo_url: repoUrl,
        branch: branch,
        port: parseInt(document.getElementById('app-port').value),
        server_id: server_id,
        env_vars: envVarsString,
        memory_limit: memoryLimit || null,
        cpu_limit: cpuLimit ? parseFloat(cpuLimit) : null,
        deploy_type: deployType,
        registry_image: registryImage || null,
    };

    try {
        const res = await fetch('/api/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModal('app-modal');
            document.getElementById('app-form').reset();
            resetEnvVarsContainer();
            toggleRepoSource('manual');
            addActivityLog(`Layihə yaradıldı: ${payload.name}`, 'app');
            loadApplications();
        } else {
            const errText = await res.text();
            addActivityLog(`Layihə yaratma uğursuz: ${payload.name}`, 'error');
            showInfoCard('❌ Xəta', 'Layihə yaranılmadı', errText);
        }
    } catch (e) {
        addActivityLog(`Layihə yaratma xətası`, 'error');
        console.error("Failed to create application", e);
    }
}

let currentActiveDeploymentId = null;
let logInterval = null;
let lastUpdateTime = null;
let lastSeenLog = '';
let updateBadgeTimer = null;

// Delete Application
async function deleteApp(appId, appName) {
    const safeName = appName || 'Adsız Layihə';
    showConfirmCard({
        icon: '🗑️',
        title: 'Tətbiq Silinsin?',
        subtitle: safeName,
        body: `<strong>DİQQƏT:</strong> Bu əməliyyat həm verilənlər bazasından, həm də serverdən (Docker konteyner, kodlar) tətbiqi tamamilə siləcək.`,
        warning: '⚠️ Bu əməliyyat geri alına bilməz!',
        confirmText: '🗑️ Sil',
        confirmStyle: 'background: #ff1744; color: white;',
        onConfirm: async () => {
            showModal('delete-terminal-modal');

            const termBody = document.getElementById('delete-terminal-body');
            termBody.innerHTML = '';

            const addLog = (text, color = '#888') => {
                const div = document.createElement('div');
                div.style.color = color;
                div.textContent = text;
                termBody.appendChild(div);
                termBody.scrollTop = termBody.scrollHeight;
                
                if (!deletionLogsCache[safeName]) {
                    deletionLogsCache[safeName] = [];
                }
                deletionLogsCache[safeName].push(text);
            };

            addLog(`[SİSTEM] Layihə silinməsi başladıldı: ${safeName}...`);

            try {
                addLog('[SİSTEM] Server tərəfində təmizləmə aparılır...', '#ff9800');

                // API DELETE sorğusunu başladırıq
                const res = await fetch(`/api/applications/${appId}`, { method: 'DELETE' });
                
                if (res.ok) {
                    addLog('✅ Layihə uğurla silindi!', '#00e676');
                    addActivityLog(`Tətbiq silindi: ${safeName}`, 'delete');
                    
                    const appsList = document.getElementById('applications-list');
                    if (appsList) appsList.removeAttribute('data-render-hash');
                    await loadApplications();

                    setTimeout(() => {
                        closeModal('delete-terminal-modal');
                        switchTab('applications');
                    }, 1000);
                } else {
                    const err = await res.text();
                    addLog(`❌ XƏTA: Server silmə sorğusunu tamamlaya bilmədi. Cavab: ${err}`, '#ff1744');
                    addActivityLog(`Tətbiq silmə uğursuz: ${safeName}`, 'error');
                    
                    const closeBtn = document.createElement('button');
                    closeBtn.textContent = 'Bağla';
                    closeBtn.style.cssText = 'margin-top: 15px; background: #555; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;';
                    closeBtn.onclick = () => { closeModal('delete-terminal-modal'); loadApplications(); };
                    termBody.appendChild(closeBtn);
                }
            } catch (e) {
                addLog(`❌ BAĞLANTI XƏTASI: Serverdən cavab alınmadı. Detal: ${e.message}`, '#ff1744');
                addActivityLog(`Tətbiq silmə xətası: ${safeName}`, 'error');
                
                const closeBtn = document.createElement('button');
                closeBtn.textContent = 'Bağla';
                closeBtn.style.cssText = 'margin-top: 15px; background: #555; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;';
                closeBtn.onclick = () => { closeModal('delete-terminal-modal'); loadApplications(); };
                termBody.appendChild(closeBtn);
            }
        }
    });
}

let cfPollingInterval = null;
let currentCfAppId = null;

function openCloudflareModal(appId, appName) {
    let modal = document.getElementById('cf-terminal-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cf-terminal-modal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal-card" style="width: 780px; height: 500px; background: #1e1e1e; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                <div style="display: flex; flex-direction: row; flex: 1; min-height: 0; background: #0c0c0c; width: 100%; height: 100%;">
                    <!-- Left: Terminal -->
                    <div style="flex: 1; display: flex; flex-direction: column; background: #0c0c0c;">
                        <!-- Terminal body -->
                        <div id="cf-terminal-body" style="flex: 1; padding: 16px; overflow-y: auto; font-family: 'Consolas', 'Courier New', Courier, monospace; font-size: 0.85rem; color: #00e676; line-height: 1.5; text-align: left; white-space: pre-wrap; word-break: break-all;">
                            <div style="color: #888;">[SİSTEM] Cloudflare tünel sessiyası başladı...</div>
                            <div style="color: #888;">[SİSTEM] Uzaq serverlə bağlantı yoxlanılır...</div>
                        </div>
                        <!-- Terminal Input Prompt -->
                        <div style="background: #0c0c0c; padding: 10px 16px; display: flex; align-items: center; gap: 8px; font-family: 'Consolas', 'Courier New', Courier, monospace; font-size: 0.85rem; border-top: 1px solid #222;">
                            <span style="color: #00d2ff; white-space: nowrap;">ubuntu@masterdeploy:~$</span>
                            <input type="text" id="cf-terminal-input" style="flex: 1; background: transparent; border: none; outline: none; color: #fff; font-family: inherit; font-size: inherit;" placeholder="Komanda yazın..." disabled />
                        </div>
                    </div>
                    
                    <!-- Right: Commands Sidebar -->
                    <div style="width: 220px; background: #1e1e1e; border-left: 1px solid #333; padding: 16px; display: flex; flex-direction: column; gap: 12px; justify-content: flex-start; align-items: stretch; box-sizing: border-box; height: 100%; overflow-y: auto;">
                        <div style="color: #888; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px;">Əmrlər</div>
                        
                        <button id="cf-start-btn" onclick="runCfCommand('start')" style="background: #27ae60; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: not-allowed; font-size: 0.85rem; font-weight: bold; text-align: left; display: flex; align-items: center; gap: 8px; opacity: 0.5;" disabled>
                            <span>▶️</span> Tüneli Başlat
                        </button>
                        
                        <button id="cf-logs-btn" onclick="runCfCommand('logs')" style="background: #2980b9; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: not-allowed; font-size: 0.85rem; font-weight: bold; text-align: left; display: flex; align-items: center; gap: 8px; opacity: 0.5;" disabled>
                            <span>📋</span> Loqları İzlə
                        </button>
                        
                        <button id="cf-stop-btn" onclick="runCfCommand('stop')" style="background: #c0392b; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: not-allowed; font-size: 0.85rem; font-weight: bold; text-align: left; display: flex; align-items: center; gap: 8px; opacity: 0.5;" disabled>
                            <span>🛑</span> Tüneli Durdur
                        </button>

                        <button id="cf-retry-btn" onclick="checkCfConnection()" style="background: #e67e22; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: not-allowed; font-size: 0.85rem; font-weight: bold; text-align: left; display: flex; align-items: center; gap: 8px; opacity: 0.5;" disabled>
                            <span>🔄</span> Yenidən Cəhd
                        </button>
                        
                        <div style="height: 1px; background: #333; margin: 8px 0;"></div>
                        <div style="color: #888; font-size: 0.75rem; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px;">Alətlər</div>
                        
                        <button onclick="runCfCommand('copy')" style="background: #444; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; text-align: left; display: flex; align-items: center; gap: 8px;">
                            <span>💾</span> Loqları Kopyala
                        </button>
                        
                        <button onclick="runCfCommand('clear')" style="background: #444; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; text-align: left; display: flex; align-items: center; gap: 8px;">
                            <span>🧹</span> Konsolu Təmizlə
                        </button>
                        
                        <div style="height: 1px; background: #333; margin: 8px 0;"></div>
                        
                        <button onclick="closeCloudflareModal(true)" style="background: #7f8c8d; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: bold; text-align: center;">
                            Bağla
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Setup input Enter key listener
        const terminalInput = document.getElementById('cf-terminal-input');
        terminalInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                const text = this.value.trim();
                if (text) {
                    const lowerText = text.toLowerCase();
                    if (lowerText === 'start' || lowerText === 'start-tunnel') {
                        runCfCommand('start');
                    } else if (lowerText === 'stop' || lowerText === 'stop-tunnel') {
                        runCfCommand('stop');
                    } else if (lowerText === 'logs' || lowerText === 'watch-logs') {
                        runCfCommand('logs');
                    } else if (lowerText === 'clear') {
                        runCfCommand('clear');
                    } else if (lowerText === 'copy') {
                        runCfCommand('copy');
                    } else {
                        appendCfLog(`\nubuntu@masterdeploy:~$ ${text}`, '#fff');
                        appendCfLog(`[MƏLUMAT] Əmr tapılmadı. Mövcud əmrlər: start, stop, logs, clear, copy`, '#ff9800');
                    }
                    this.value = '';
                }
            }
        });
    }

    showModal('cf-terminal-modal');

    const headerTitle = modal.querySelector('.win-title-text');
    if (headerTitle) {
        headerTitle.innerHTML = `
            ☁️ Cloudflare Tunnel: <span id="cf-app-name" style="color: #ff9800; font-weight: bold;">${appName}</span>
            <span id="cf-tunnel-url-container" style="font-size: 0.75rem; color: #ff9800; font-weight: bold; background: rgba(0, 0, 0, 0.4); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(255,152,0,0.2); margin-left: 10px;">Status: Hazır</span>
        `;
    }

    document.getElementById('cf-terminal-body').innerHTML = `
        <div style="color: #888;">[SİSTEM] Cloudflare tünel sessiyası başladı...</div>
        <div style="color: #888;">[SİSTEM] Uzaq serverlə bağlantı yoxlanılır...</div>
    `;
    setTimeout(checkCfConnection, 500);
}

async function checkCfConnection() {
    if (!currentCfAppId) return;

    setCfButtonsState(false, false);
    appendCfLog('[SİSTEM] Qoşulma yoxlanılır...', '#ff9800');

    try {
        const res = await fetch(`/api/plugins/cloudflare/logs/${currentCfAppId}`);
        if (res.ok) {
            appendCfLog('[SİSTEM] Uzaq serverlə əlaqə uğurla quruldu! Əmrlər aktivdir.', '#00e676');
            setCfButtonsState(true, false);
        } else {
            const err = await res.text();
            appendCfLog(`[XƏTA] Uzaq serverə qoşulmaq mümkün olmadı (Qoşulma uğursuz): ${err}`, '#ff1744');
            setCfButtonsState(false, true);
        }
    } catch (e) {
        appendCfLog(`[XƏTA] Şəbəkə və ya qoşulma xətası: ${e.message}`, '#ff1744');
        setCfButtonsState(false, true);
    }
}

function setCfButtonsState(commandsEnabled, retryEnabled) {
    const cmdBtns = ['cf-start-btn', 'cf-logs-btn', 'cf-stop-btn'];
    cmdBtns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = !commandsEnabled;
            btn.style.opacity = commandsEnabled ? '1' : '0.5';
            btn.style.cursor = commandsEnabled ? 'pointer' : 'not-allowed';
        }
    });

    const retryBtn = document.getElementById('cf-retry-btn');
    if (retryBtn) {
        retryBtn.disabled = !retryEnabled;
        retryBtn.style.opacity = retryEnabled ? '1' : '0.5';
        retryBtn.style.cursor = retryEnabled ? 'pointer' : 'not-allowed';
    }

    const input = document.getElementById('cf-terminal-input');
    if (input) {
        input.disabled = !commandsEnabled;
    }
}

async function closeCloudflareModal(shouldStop) {
    if (cfPollingInterval) {
        clearInterval(cfPollingInterval);
        cfPollingInterval = null;
    }
    closeModal('cf-terminal-modal');

    if (shouldStop && currentCfAppId) {
        try {
            await fetch(`/api/plugins/cloudflare/stop/${currentCfAppId}`, { method: 'POST' });
            addActivityLog("Cloudflare tuneli istifadəçi tərəfindən dayandırıldı", 'info');
        } catch (e) {
            console.error(e);
        }
        loadApplications();
    }
    currentCfAppId = null;
}

// Generate Cloudflare Tunnel
async function generateCloudflareTunnel(event, id) {
    if (event) event.stopPropagation();

    const appName = event ? (event.currentTarget.closest('.list-item') ? event.currentTarget.closest('.list-item').querySelector('h3').innerText.split('\n')[0].replace('🚀', '').trim() : id) : id;

    currentCfAppId = id;
    openCloudflareModal(id, appName);
}

async function runCfCommand(cmdType) {
    if (!currentCfAppId) return;

    if (cfPollingInterval) {
        clearInterval(cfPollingInterval);
        cfPollingInterval = null;
    }

    if (cmdType === 'start') {
        appendCfLog(`\nubuntu@masterdeploy:~$ start-tunnel`, '#fff');
        appendCfLog('[SİSTEM] Konteyner başladılır...', '#ff9800');
        document.getElementById('cf-tunnel-url-container').innerText = '🔗 Başladılır...';

        try {
            const res = await fetch(`/api/plugins/cloudflare/start/${currentCfAppId}`, { method: 'POST' });
            if (res.ok) {
                appendCfLog('[SİSTEM] Konteyner uğurla işə salındı! Canlı loqlar izlənilir...', '#00e676');
                startCfLogsPolling();
            } else {
                const err = await res.text();
                appendCfLog(`[XƏTA] Başlatma xətası: ${err}`, '#ff1744');
                document.getElementById('cf-tunnel-url-container').innerText = '❌ Xəta baş verdi';
            }
        } catch (e) {
            appendCfLog(`[SİSTEM XƏTASI] Qoşulma xətası: ${e.message}`, '#ff1744');
        }

    } else if (cmdType === 'logs') {
        appendCfLog(`\nubuntu@masterdeploy:~$ watch-logs`, '#fff');
        appendCfLog('[SİSTEM] Loq izləmə başladılır...', '#00e676');
        startCfLogsPolling();

    } else if (cmdType === 'stop') {
        appendCfLog(`\nubuntu@masterdeploy:~$ stop-tunnel`, '#fff');
        appendCfLog('[SİSTEM] Konteyner dayandırılır və silinir...', '#c0392b');
        document.getElementById('cf-tunnel-url-container').innerText = '🛑 Tünel dayandırıldı';

        try {
            const res = await fetch(`/api/plugins/cloudflare/stop/${currentCfAppId}`, { method: 'POST' });
            if (res.ok) {
                appendCfLog('[SİSTEM] Konteyner tamamilə dayandırıldı və silindi.', '#ff1744');
                loadApplications();
            } else {
                const err = await res.text();
                appendCfLog(`[XƏTA] Dayandırma xətası: ${err}`, '#ff1744');
            }
        } catch (e) {
            appendCfLog(`[SİSTEM XƏTASI] Qoşulma xətası: ${e.message}`, '#ff1744');
        }

    } else if (cmdType === 'clear') {
        document.getElementById('cf-terminal-body').innerHTML = '<div style="color: #888;">[SİSTEM] Terminal təmizləndi...</div>';

    } else if (cmdType === 'copy') {
        const text = document.getElementById('cf-terminal-body').innerText;
        navigator.clipboard.writeText(text).then(() => {
            appendCfLog('\n[SİSTEM] Bütün terminal mətnləri panoya kopyalandı.', '#00e676');
        }).catch(err => {
            appendCfLog('\n[XƏTA] Kopyalamaq mümkün olmadı: ' + err, '#ff1744');
        });
    }
}

function startCfLogsPolling() {
    if (cfPollingInterval) clearInterval(cfPollingInterval);

    let urlFound = false;
    cfPollingInterval = setInterval(async () => {
        if (!currentCfAppId) return;
        try {
            const logRes = await fetch(`/api/plugins/cloudflare/logs/${currentCfAppId}`);
            if (logRes.ok) {
                const data = await logRes.json();

                const termBody = document.getElementById('cf-terminal-body');
                termBody.innerText = data.logs;
                termBody.scrollTop = termBody.scrollHeight;

                if (data.cloudflare_url) {
                    document.getElementById('cf-tunnel-url-container').innerHTML = `
                        🔗 Link: <a href="${data.cloudflare_url}" target="_blank" style="color: #00e676; text-decoration: underline;">${data.cloudflare_url}</a>
                    `;
                    if (!urlFound) {
                        urlFound = true;
                        addActivityLog(`Cloudflare tunel linki alındı: ${data.cloudflare_url}`, 'success');
                    }
                }
            } else {
                // Log çəkmək alınmadı (məsələn SSH əlaqəsi qopdu)
                clearInterval(cfPollingInterval);
                cfPollingInterval = null;
                appendCfLog('\n[XƏTA] Uzaq serverlə əlaqə kəsildi (Loqlar oxunmadı).', '#ff1744');
                setCfButtonsState(false, true); // Yenidən Cəhd aktiv, digərləri disabled
            }
        } catch (e) {
            clearInterval(cfPollingInterval);
            cfPollingInterval = null;
            console.error("Logs polling failed", e);
            appendCfLog(`\n[XƏTA] Şəbəkə bağlantısı kəsildi: ${e.message}`, '#ff1744');
            setCfButtonsState(false, true);
        }
    }, 1500);
}

function appendCfLog(text, color = '#00e676') {
    const termBody = document.getElementById('cf-terminal-body');
    if (termBody) {
        const div = document.createElement('div');
        div.style.color = color;
        div.innerText = text;
        termBody.appendChild(div);
        termBody.scrollTop = termBody.scrollHeight;
    }
}

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

// ============================================================
// App Settings Modal Functions
// ============================================================

let currentSettingsAppId = null;


async function openAppSettings(appId, showModalBool = true) {
    console.time("  -> openAppSettings TOTAL");
    currentSettingsAppId = appId;
    try {
        console.time("  -> [FETCH] openAppSettings application");
        const res = await fetch(`/api/applications/${appId}`);
        console.timeEnd("  -> [FETCH] openAppSettings application");
        
        if (!res.ok) { alert('Layihə məlumatları yüklənmədi.'); return; }
        const app = await res.json();

        if (githubToken && gitHubRepos.length === 0) {
            console.time("  -> [CALL] loadGithubRepos");
            loadGithubRepos();
            console.timeEnd("  -> [CALL] loadGithubRepos");
        }

        const nameLabel = document.getElementById('settings-app-name-label');
        if (nameLabel) nameLabel.innerText = `🚀 ${app.name}`;

        document.getElementById('settings-repo-url').value = app.repo_url || '';
        
        let repoNameOnly = '';
        if (app.repo_url) {
            repoNameOnly = app.repo_url.replace('https://github.com/', '').replace('https://', '');
            if (repoNameOnly.endsWith('.git')) {
                repoNameOnly = repoNameOnly.slice(0, -4);
            }
        }
        const searchInput = document.getElementById('settings-repo-search');
        if (searchInput) {
            searchInput.value = repoNameOnly || '';
        }

        document.getElementById('settings-branch').value = app.branch || 'main';
        document.getElementById('settings-port').value = app.port || 8080;
        populateSettingsEnvVars(app.env_vars || '');
        document.getElementById('settings-build-command').value = app.build_command || '';
        document.getElementById('settings-run-command').value = app.run_command || '';
        document.getElementById('settings-dockerfile-path').value = app.dockerfile_path || '';
        document.getElementById('settings-entrypoint').value = app.entrypoint || '';
        document.getElementById('settings-command').value = app.command || '';
        const workDirEl = document.getElementById('settings-work-dir');
        if (workDirEl) workDirEl.value = app.work_dir || '';
        document.getElementById('settings-memory-limit').value = app.memory_limit || '';
        document.getElementById('settings-cpu-limit').value = app.cpu_limit || '';
        const cfWorkerUrlEl = document.getElementById('settings-cf-worker-url');
        if (cfWorkerUrlEl) cfWorkerUrlEl.value = app.cf_worker_url || '';

        const depType = app.deploy_type || 'git';
        const regImg = app.registry_image || '';
        const depTypeEl = document.getElementById('settings-deploy-type');
        if (depTypeEl) {
            depTypeEl.value = depType;
            toggleDeployTypeFields('settings');
        }
        const regImgEl = document.getElementById('settings-registry-image');
        if (regImgEl) regImgEl.value = regImg;

        // Auto-Deploy Fields
        const autoEnabledEl = document.getElementById('settings-autodeploy-enabled');
        if (autoEnabledEl) {
            autoEnabledEl.checked = app.auto_deploy_enabled === 1;
        }
        const autoIntervalEl = document.getElementById('settings-autodeploy-interval');
        if (autoIntervalEl) {
            autoIntervalEl.value = app.auto_deploy_interval != null ? String(app.auto_deploy_interval) : '15';
        }
        const autoTimeoutEl = document.getElementById('settings-autodeploy-timeout');
        if (autoTimeoutEl) {
            autoTimeoutEl.value = app.auto_deploy_timeout != null ? String(app.auto_deploy_timeout) : '10';
        }

        const bpt = app.build_pack_type || 'dockerfile';
        settingsSelectBuild(bpt);

        if (showModalBool) showModal('app-settings-modal');
    } catch (e) {
        console.error('openAppSettings error', e);
    }
    console.timeEnd("  -> openAppSettings TOTAL");
}

function settingsSelectBuild(type) {
    const bpBtn = document.getElementById('settings-bp-btn');
    const dfBtn = document.getElementById('settings-df-btn');
    const bpFields = document.getElementById('settings-bp-fields');
    const dfFields = document.getElementById('settings-df-fields');

    if (type === 'buildpack') {
        bpBtn.style.background = 'rgba(0,210,255,0.15)';
        bpBtn.style.color = 'var(--accent-color)';
        bpBtn.style.borderColor = 'var(--accent-color)';
        dfBtn.style.background = 'transparent';
        dfBtn.style.color = 'var(--text-secondary)';
        dfBtn.style.borderColor = 'var(--card-border)';
        bpFields.style.display = 'block';
        dfFields.style.display = 'none';
    } else {
        dfBtn.style.background = 'rgba(0,210,255,0.15)';
        dfBtn.style.color = 'var(--accent-color)';
        dfBtn.style.borderColor = 'var(--accent-color)';
        bpBtn.style.background = 'transparent';
        bpBtn.style.color = 'var(--text-secondary)';
        bpBtn.style.borderColor = 'var(--card-border)';
        bpFields.style.display = 'none';
        dfFields.style.display = 'block';
    }
    settingsCurrentBuildType = type;
}

let settingsCurrentBuildType = 'dockerfile';

function buildSettingsPayload() {
    return {
        repo_url: document.getElementById('settings-repo-url').value.trim() || "",
        branch: document.getElementById('settings-branch').value.trim() || "",
        port: parseInt(document.getElementById('settings-port').value) || null,
        env_vars: getSettingsEnvVarsString() || null,
        build_pack_type: settingsCurrentBuildType,
        build_command: document.getElementById('settings-build-command').value.trim() || null,
        run_command: document.getElementById('settings-run-command').value.trim() || null,
        dockerfile_path: document.getElementById('settings-dockerfile-path').value.trim() || null,
        entrypoint: document.getElementById('settings-entrypoint').value.trim() || null,
        command: document.getElementById('settings-command').value.trim() || null,
        work_dir: document.getElementById('settings-work-dir').value.trim() || null,
        memory_limit: document.getElementById('settings-memory-limit').value.trim() || null,
        cpu_limit: parseFloat(document.getElementById('settings-cpu-limit').value.trim()) || null,
        cf_worker_url: document.getElementById('settings-cf-worker-url').value.trim() || null,
        deploy_type: document.getElementById('settings-deploy-type').value,
        registry_image: document.getElementById('settings-registry-image').value.trim() || null,
        auto_deploy_enabled: document.getElementById('settings-autodeploy-enabled')?.checked ? 1 : 0,
        auto_deploy_interval: parseInt(document.getElementById('settings-autodeploy-interval')?.value) || 15,
        auto_deploy_timeout: parseInt(document.getElementById('settings-autodeploy-timeout')?.value) || 10,
    };
}



async function saveAppSettings() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) {
        alert("Layihə seçilməyib!");
        return;
    }
    const payload = buildSettingsPayload();
    try {
        const res = await fetch(`/api/applications/${appId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            alert('Ayarlar uğurla yadda saxlanıldı!');
            loadApplications();
            // Pending redeploy bayrağını qoy
            localStorage.setItem(`pending_redeploy_${appId}`, 'true');
            markRedeployPending(true);
        } else {
            const err = await res.text();
            alert('Yadda saxlamaqda xəta: ' + err);
        }
    } catch (e) {
        console.error('saveAppSettings error', e);
        alert('Serverlə əlaqə xətası: ' + e);
    }
}

async function redeployApp() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) {
        alert("Layihə seçilməyib!");
        return;
    }
    // Pending redeploy bayrağını sıfırla
    localStorage.removeItem(`pending_redeploy_${appId}`);
    markRedeployPending(false);
    deployApp(appId, true); // no_cache=true → tam təmiz yığım
}

async function cacheDeployApp() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) {
        alert("Layihə seçilməyib!");
        return;
    }
    localStorage.removeItem(`pending_redeploy_${appId}`);
    markRedeployPending(false);
    deployApp(appId, false); // no_cache=false → Docker keşini istifadə edir (sürətli)
}

// ============================================================
// Auto-Deploy: Manual Check Trigger (⚡ İndi Yoxla)
// ============================================================
let isManualDeployChecking = false;

async function triggerManualDeployCheck(appId) {
    if (!appId) {
        appId = currentSettingsAppId || currentAppId || currentAppDetailsId;
    }
    if (!appId) {
        showToast('Zəhmət olmasa yoxlamaq üçün layihə seçin.', 'warning');
        return;
    }
    if (isManualDeployChecking) {
        showToast('Yoxlanış artıq aparılır, zəhmət olmasa gözləyin...', 'info');
        return;
    }

    isManualDeployChecking = true;

    // UI Düyməsinin vəziyyətini dəyişirik
    const checkBtns = [document.getElementById('btn-app-check-deploy')];
    const originalTexts = [];

    checkBtns.forEach(btn => {
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.style.cursor = 'not-allowed';
            const txtEl = btn.querySelector('#btn-app-check-deploy-text') || btn;
            originalTexts.push({ btn, html: btn.innerHTML });
            btn.innerHTML = `<svg class="spin-icon" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;animation:spin 1s linear infinite;" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>Yoxlanılır...</span>`;
        }
    });

    showToast('🔎 Auto-Deploy yoxlanışı başladı... Cavab gözlənilir.', 'info');

    try {
        const res = await fetch(`/api/applications/${appId}/check-deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (res.ok) {
            const data = await res.json();
            if (data.status === 'new_version') {
                showToast(`🚀 ${data.message}`, 'success');
            } else if (data.status === 'up_to_date') {
                showToast(`✅ ${data.message}`, 'success');
            } else if (data.status === 'timeout') {
                showToast(`⏳ ${data.message}`, 'warning');
            } else {
                showToast(`⚠️ ${data.message || 'Yoxlanış başa çatdı.'}`, 'warning');
            }
        } else {
            const errText = await res.text();
            showToast(`❌ Yoxlama xətası: ${errText}`, 'error');
        }

        // Fəaliyyət jurnalını və Overview detallarını yeniləyirik
        if (typeof renderActivityLogs === 'function') {
            renderActivityLogs();
        }
        // Əgər app details açıqdırsa məlumatları yenidən yükləyirik
        if (typeof openAppDetails === 'function' && currentAppDetailsId === appId) {
            openAppDetails(appId, false);
        }

    } catch (e) {
        console.error('triggerManualDeployCheck error', e);
        showToast(`❌ Şəbəkə xətası: ${e.message}`, 'error');
    } finally {
        // Təhlükəsizlik üçün ən azı 3 saniyə düyməni blokda saxlayırıq
        setTimeout(() => {
            isManualDeployChecking = false;
            originalTexts.forEach(item => {
                if (item.btn) {
                    item.btn.disabled = false;
                    item.btn.style.opacity = '1';
                    item.btn.style.cursor = 'pointer';
                    item.btn.innerHTML = item.html;
                }
            });
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }, 3000);
    }
}

// Redeploy düyməsinə pending sinifini əlavə et / sil
function markRedeployPending(isPending) {
    const btn = document.getElementById('btn-app-redeploy');
    if (!btn) return;
    if (isPending) {
        btn.classList.add('pending-redeploy');
    } else {
        btn.classList.remove('pending-redeploy');
    }
}

async function stopApp() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) return;
    const btn = document.getElementById('btn-app-stop');
    const orig = btn.innerText;
    btn.innerText = '⏳ Dayandırılır...';
    btn.disabled = true;
    try {
        const res = await fetch(`/api/applications/${appId}/stop`, { method: 'POST' });
        if (res.ok) {
            alert('Layihə uğurla dayandırıldı!');
            loadApplications();
            if (typeof openAppDetails === 'function') openAppDetails(appId);
        } else {
            const err = await res.text();
            alert('Dayandırmaqda xəta: ' + err);
        }
    } catch (e) {
        alert('Serverlə əlaqə xətası: ' + e);
    } finally {
        btn.innerText = orig;
        btn.disabled = false;
    }
}

async function restartApp() {
    const appId = currentSettingsAppId || currentAppId;
    if (!appId) return;
    const btn = document.getElementById('btn-app-restart');
    const orig = btn.innerText;
    btn.innerText = '⏳ Yenidən başladılır...';
    btn.disabled = true;
    try {
        const res = await fetch(`/api/applications/${appId}/restart`, { method: 'POST' });
        if (res.ok) {
            alert('Layihə uğurla yenidən başladıldı!');
            loadApplications();
            if (typeof openAppDetails === 'function') openAppDetails(appId);
        } else {
            const err = await res.text();
            alert('Yenidən başlatmaqda xəta: ' + err);
        }
    } catch (e) {
        alert('Serverlə əlaqə xətası: ' + e);
    } finally {
        btn.innerText = orig;
        btn.disabled = false;
    }
}


// Copy terminal logs to clipboard
function copyTerminalLogs() {
    const terminal = document.getElementById('terminal-body');
    const text = terminal.innerText || terminal.textContent || '';
    if (!text.trim()) return;

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copy-logs-btn');
        const original = btn.innerHTML;
        btn.innerHTML = '✅ Kopyalandı';
        btn.style.color = 'var(--success-color)';
        btn.style.borderColor = 'var(--success-color)';
        setTimeout(() => {
            btn.innerHTML = original;
            btn.style.color = '';
            btn.style.borderColor = '';
        }, 2000);
    }).catch(() => {
        // Fallback for older browsers
        const range = document.createRange();
        range.selectNodeContents(terminal);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
    });
}

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
    const initialStyle = document.getElementById('initial-tab-lock');
    if (initialStyle) initialStyle.remove();

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
        const searchInput = document.getElementById('coolify-search-keys');
        if (searchInput) searchInput.value = '';
        if (typeof loadSshKeys === 'function') loadSshKeys();
        if (typeof loadLocalSshKey === 'function') loadLocalSshKey();
        if (typeof loadGithubTokenStatus === 'function') loadGithubTokenStatus();
        if (typeof filterCoolifyKeys === 'function') filterCoolifyKeys();
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
    const wizAppName = document.getElementById('wiz-app-name');
    if (wizAppName) wizAppName.value = '';
    const wizAppRepo = document.getElementById('wiz-app-repo');
    if (wizAppRepo) wizAppRepo.value = '';
    const wizRegImg = document.getElementById('wiz-registry-image');
    if (wizRegImg) wizRegImg.value = '';

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

async function loadWizServers() {
    try {
        const res = await fetch('/api/servers');
        const servers = await res.json();
        const serverSelect = document.getElementById('wiz-app-server');
        const appServerSelect = document.getElementById('app-server');

        if (servers.length === 0) {
            if (serverSelect) serverSelect.innerHTML = `<option value="">Öncə server əlavə edin</option>`;
            if (appServerSelect) appServerSelect.innerHTML = `<option value="">Öncə server əlavə edin</option>`;
            return;
        }

        const optionsHtml = servers.map(s => `<option value="${s.id}">${s.name} (${s.ip})</option>`).join('');
        if (serverSelect) serverSelect.innerHTML = optionsHtml;
        if (appServerSelect) appServerSelect.innerHTML = optionsHtml;
        
        if (serverSelect) updateServerStatsAdvisor('wiz-app-server', 'wiz-server-advisor', 'wiz-app-memory', 'wiz-app-cpu');
    } catch (e) {
        console.error("loadWizServers error:", e);
    }
}

function goBackFromConfig() {
    if (wizSelectedSource === 'docker') {
        goToStep(1);
    } else {
        goToStep(3);
    }
}

// Wizard ENV Builder helper functions
function addWizEnvVarRow(key = '', val = '') {
    const container = document.getElementById('wiz-env-vars-container');
    const row = document.createElement('div');
    row.className = 'wiz-env-var-row';
    row.style.display = 'flex';
    row.style.gap = '0.5rem';
    row.style.marginBottom = '0.4rem';
    row.style.alignItems = 'center';

    row.innerHTML = `
        <input type="text" placeholder="Açar (Key)" class="wiz-env-key" value="${key}" style="flex: 1; padding: 0.5rem 0.8rem; font-size: 0.82rem; border-radius: 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);">
        <input type="text" placeholder="Dəyər (Value)" class="wiz-env-value" value="${val}" style="flex: 2; padding: 0.5rem 0.8rem; font-size: 0.82rem; border-radius: 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);">
        <button type="button" onclick="this.parentElement.remove()" title="Sil" style="background: rgba(255, 23, 68, 0.08); border: 1px solid rgba(255, 23, 68, 0.2); color: #ff1744; border-radius: 6px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(255, 23, 68, 0.2)'" onmouseout="this.style.background='rgba(255, 23, 68, 0.08)'">
            <svg style="width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;
    container.appendChild(row);
}

function resetWizEnvVarsContainer() {
    const container = document.getElementById('wiz-env-vars-container');
    if (container) {
        container.innerHTML = '';
        addWizEnvVarRow(); // Add one default empty row
    }
}

// Final Deploy Trigger from Wizard
async function handleWizardDeploy(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const modal = document.getElementById('create-service-modal');
    if (modal && (modal.style.display === 'none' || modal.classList.contains('minimized'))) {
        return;
    }

    try {
        const appNameInput = document.getElementById('wiz-app-name');
        const appPortInput = document.getElementById('wiz-app-port');
        const appServerSelect = document.getElementById('wiz-app-server');
        const deployTypeSelect = document.getElementById('wiz-deploy-type');
        const registryImageInput = document.getElementById('wiz-registry-image');
        const appRepoInput = document.getElementById('wiz-app-repo');
        const appBranchInput = document.getElementById('wiz-app-branch');

        const appName = appNameInput ? appNameInput.value.trim() : '';
        if (!appName) {
            showToast('Zəhmət olmasa Service Name (Tətbiq adı) daxil edin.', 'warning');
            if (appNameInput) appNameInput.focus();
            return;
        }

        const portVal = appPortInput ? parseInt(appPortInput.value) : 0;
        if (!portVal || isNaN(portVal) || portVal <= 0) {
            showToast('Zəhmət olmasa düzgün Daxili Port nömrəsi daxil edin.', 'warning');
            if (appPortInput) appPortInput.focus();
            return;
        }

        const serverId = appServerSelect ? appServerSelect.value : '';
        if (!serverId) {
            showToast('Zəhmət olmasa Hədəf Serveri seçin.', 'warning');
            return;
        }

        const deployType = deployTypeSelect ? deployTypeSelect.value : 'git';
        const registryImage = registryImageInput ? registryImageInput.value.trim() : '';
        const repoUrlVal = appRepoInput ? appRepoInput.value.trim() : '';
        const branchVal = appBranchInput ? appBranchInput.value.trim() : 'main';

        let repoUrl = "";
        let branch = branchVal || "main";

        if (deployType === 'git') {
            if (repoUrlVal) {
                repoUrl = repoUrlVal;
            } else if (typeof wizSelectedRepo !== 'undefined' && wizSelectedRepo && wizSelectedRepo.manualUrl) {
                repoUrl = wizSelectedRepo.manualUrl;
            } else if (typeof wizSelectedRepo !== 'undefined' && wizSelectedRepo && wizSelectedRepo.full_name) {
                const token = typeof githubToken !== 'undefined' ? githubToken : '';
                if (wizSelectedRepo.private && token) {
                    repoUrl = `https://${token}@github.com/${wizSelectedRepo.full_name}.git`;
                } else {
                    repoUrl = `https://github.com/${wizSelectedRepo.full_name}.git`;
                }
            }

            if (!repoUrl) {
                const srcContent = document.getElementById('wiz-source-content');
                if (srcContent && srcContent.style.display === 'none') {
                    toggleAccordion('wiz-source-content', srcContent.previousElementSibling);
                }
                alert("⚠️ Zəhmət olmasa 'Mənbə və Yayım Tipi' bölməsindən Git Repo URL daxil edin.");
                if (appRepoInput) appRepoInput.focus();
                return;
            }
        } else {
            if (!registryImage) {
                const srcContent = document.getElementById('wiz-source-content');
                if (srcContent && srcContent.style.display === 'none') {
                    toggleAccordion('wiz-source-content', srcContent.previousElementSibling);
                }
                alert("⚠️ Zəhmət olmasa 'Mənbə və Yayım Tipi' bölməsindən Docker Registry İmic Linkini daxil edin.");
                if (registryImageInput) registryImageInput.focus();
                return;
            }
            repoUrl = registryImage;
            branch = "latest";
        }

        // Build ENV vars string
        const keys = document.querySelectorAll('.wiz-env-key');
        const values = document.querySelectorAll('.wiz-env-value');
        let envVarsList = [];
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i].value.trim();
            const v = values[i].value.trim();
            if (k) {
                envVarsList.push(`${k}=${v}`);
            }
        }
        const envVarsString = envVarsList.join('\n');

        const buildPackType = (typeof wizSelectedBuildOption !== 'undefined' && wizSelectedBuildOption) ? wizSelectedBuildOption : 'dockerfile';
        let buildCommand = null;
        let runCommand = null;
        let dockerfilePath = null;
        let entrypoint = null;
        let command = null;
        let target = null;
        let workDir = null;
        let privileged = 0;

        const bpBuildCmd = document.getElementById('wiz-bp-build-command');
        const bpRunCmd = document.getElementById('wiz-bp-run-command');
        const bpWorkDir = document.getElementById('wiz-bp-work-dir');
        const bpPriv = document.getElementById('wiz-bp-privileged');

        const dfPath = document.getElementById('wiz-df-path');
        const dfEntry = document.getElementById('wiz-df-entrypoint');
        const dfCmd = document.getElementById('wiz-df-command');
        const dfTarget = document.getElementById('wiz-df-target');
        const dfWorkDir = document.getElementById('wiz-df-work-dir');
        const dfPriv = document.getElementById('wiz-df-privileged');

        if (buildPackType === 'buildpack') {
            buildCommand = bpBuildCmd ? bpBuildCmd.value.trim() || null : null;
            runCommand = bpRunCmd ? bpRunCmd.value.trim() || null : null;
            workDir = bpWorkDir ? bpWorkDir.value.trim() || null : null;
            privileged = bpPriv && bpPriv.checked ? 1 : 0;
        } else {
            dockerfilePath = dfPath ? dfPath.value.trim() || null : null;
            entrypoint = dfEntry ? dfEntry.value.trim() || null : null;
            command = dfCmd ? dfCmd.value.trim() || null : null;
            target = dfTarget ? dfTarget.value.trim() || null : null;
            workDir = dfWorkDir ? dfWorkDir.value.trim() || null : null;
            privileged = dfPriv && dfPriv.checked ? 1 : 0;
        }

        const memInput = document.getElementById('wiz-app-memory');
        const cpuInput = document.getElementById('wiz-app-cpu');
        const memoryLimit = memInput ? memInput.value.trim() : '';
        const cpuLimit = cpuInput ? cpuInput.value.trim() : '';

        const payload = {
            name: appName,
            repo_url: repoUrl,
            branch: branch || 'main',
            port: appPortInput ? parseInt(appPortInput.value) || 8080 : 8080,
            server_id: serverId,
            env_vars: envVarsString,
            build_pack_type: buildPackType,
            build_command: buildCommand,
            run_command: runCommand,
            dockerfile_path: dockerfilePath,
            entrypoint: entrypoint,
            command: command,
            target: target,
            work_dir: workDir,
            privileged: privileged,
            memory_limit: memoryLimit || null,
            cpu_limit: cpuLimit ? parseFloat(cpuLimit) : null,
            deploy_type: deployType,
            registry_image: registryImage || null,
        };

        const submitBtn = document.getElementById('btn-wiz-submit-deploy');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Yaradılır...';
        }

        const res = await fetch('/api/applications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const app = await res.json();
            addActivityLog(`Yeni tətbiq yaradıldı (Wizard): '${payload.name}' (Port: ${payload.port})`, 'app');
            closeModal('create-service-modal');
            await loadApplications();
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Qur və Yayına Al (Deploy)';
            }
            // Trigger deployment immediately!
            if (app && app.id) {
                deployApp(app.id);
            }
        } else {
            const errText = await res.text();
            addActivityLog(`Tətbiq yaradılarkən xəta (Wizard): '${payload.name}' - ${errText}`, 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Qur və Yayına Al (Deploy)';
            }
            alert("Xəta baş verdi: " + errText);
        }
    } catch (e) {
        console.error("Wizard deploy failed", e);
        addActivityLog(`Tətbiq yaratma xətası (Wizard): ${e.message}`, 'error');
        const submitBtn = document.getElementById('btn-wiz-submit-deploy');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Qur və Yayına Al (Deploy)';
        }
        alert("Gözlənilməz xəta baş verdi: " + (e.message || e));
    }
}

// Layout Spacing Debugger
function toggleDebugMode() {
    document.body.classList.toggle('debug-mode');
    updateDebugDimensions();
}

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

// Server Stats fetching logic
let serverStatsCache = {};

async function fetchServerStats() {
    if (!document.getElementById('tab-applications').classList.contains('active')) {
        setTimeout(fetchServerStats, 10000);
        return;
    }

    try {
        const res = await fetch('/api/servers');
        if (!res.ok) throw new Error("Failed to fetch servers list");
        const servers = await res.json();

        await Promise.all(servers.map(async (server) => {
            try {
                const statsRes = await fetch(`/api/servers/${server.id}/stats`);
                if (statsRes.ok) {
                    const stats = await statsRes.json();
                    serverStatsCache[server.id] = stats;
                }
            } catch (e) {
                console.error(`Failed to fetch stats for server ${server.id}:`, e);
            }
        }));

        updateStatsUI(servers);
    } catch (e) {
        console.error("Failed to fetch server stats in loop:", e);
    }

    setTimeout(fetchServerStats, 10000);
}

function updateStatsUI(servers) {
    if (!Array.isArray(servers)) return;

    servers.forEach(server => {
        const stats = serverStatsCache[server.id];
        if (!stats) return;

        // Auto-update server status badge to connected if metrics respond
        const statusEl = document.getElementById(`status-${server.id}`);
        if (statusEl && (stats.total_ram_mb > 0 || stats.cores > 0)) {
            statusEl.innerHTML = `Qoşulub ✅`;
            statusEl.style.color = '#00e676';
            statusEl.style.background = 'rgba(0, 230, 118, 0.1)';
        }

        // Update CPU badge
        const cpuEl = document.getElementById(`srv-stats-cpu-${server.id}`);
        if (cpuEl) {
            cpuEl.innerHTML = `CPU: <strong>${stats.cores} Nüvə</strong>`;
        }

        // Update RAM badge
        const ramEl = document.getElementById(`srv-stats-ram-${server.id}`);
        if (ramEl) {
            ramEl.innerHTML = `RAM: <strong>${stats.used_ram_mb} / ${stats.total_ram_mb} MB</strong>`;

            const ramPercent = stats.used_ram_mb / stats.total_ram_mb;
            if (ramPercent > 0.85) {
                ramEl.style.color = '#ff1744'; // Red
            } else if (ramPercent > 0.6) {
                ramEl.style.color = '#ffb300'; // Orange
            } else {
                ramEl.style.color = '#00e676'; // Green
            }
        }

        // Update individual application badges under this server
        const srvGroup = document.querySelector(`.server-group[data-server-id="${server.id}"]`);
        if (srvGroup) {
            const badges = srvGroup.querySelectorAll(`.app-load-badge`);
            badges.forEach(badge => {
                badge.innerHTML = `⚡ CPU: <strong>0%</strong> | 💾 RAM: <strong>0MB</strong>`;
            });
        }

        if (stats.containers) {
            Object.keys(stats.containers).forEach(appName => {
                const cstats = stats.containers[appName];
                const badges = document.querySelectorAll(`.app-load-badge[data-app-name="${appName}"]`);
                badges.forEach(badge => {
                    badge.innerHTML = `⚡ CPU: <strong>${cstats.cpu}</strong> | 💾 RAM: <strong>${cstats.memory}</strong>`;
                });
            });
        }

    });
}

function goToServerSettings(serverId) {
    if (event) event.stopPropagation();
    switchTab('servers');
    editServer(serverId);
}


// Accordion toggle logic
function toggleAccordion(contentId, headerElement) {
    const content = document.getElementById(contentId);
    const icon = headerElement.querySelector('.accordion-icon');

    // Check if the clicked one is currently closed
    const isClosed = content.style.display === 'none';

    // Close all accordions first
    document.querySelectorAll('.accordion-content').forEach(el => {
        el.style.display = 'none';
    });
    document.querySelectorAll('.accordion-icon').forEach(el => {
        if (el.classList.contains('toggle-text-btn')) {
            el.innerText = 'Göstər';
            el.style.background = 'rgba(255,255,255,0.1)';
        } else {
            el.style.transform = 'rotate(0deg)';
        }
    });

    // If it was closed, open it. Otherwise, it stays closed (toggle behavior)
    if (isClosed) {
        content.style.display = 'flex';
        if (icon.classList.contains('toggle-text-btn')) {
            icon.innerText = 'Gizlət';
            icon.style.background = 'var(--accent-color)';
        } else {
            icon.style.transform = 'rotate(180deg)';
        }
    }
}

// Switch Log Panels (Build vs Live)
function switchLogPanel(panelId) {
    const buildBtn = document.getElementById('btn-show-build');
    const liveBtn = document.getElementById('btn-show-live');
    const buildCont = document.getElementById('build-content');
    const liveCont = document.getElementById('live-content');

    if (!buildBtn || !liveBtn || !buildCont || !liveCont) return;

    if (panelId === 'build') {
        buildBtn.classList.add('active');
        liveBtn.classList.remove('active');
        buildCont.style.display = 'flex';
        liveCont.style.display = 'none';
        stopRuntimeLogPolling();
    } else {
        liveBtn.classList.add('active');
        buildBtn.classList.remove('active');
        buildCont.style.display = 'none';
        liveCont.style.display = 'flex';
        if (currentAppId) {
            stopRuntimeLogPolling();
            fetchRuntimeLogs(currentAppId);
        }
    }


}

// Auto-fill and advisor for Server Stats
async function updateServerStatsAdvisor(selectId, advisorDivId, memInputId, cpuInputId) {
    const serverId = document.getElementById(selectId).value;
    const advisorDiv = document.getElementById(advisorDivId);

    if (!serverId) {
        advisorDiv.style.display = 'none';
        return;
    }

    advisorDiv.style.display = 'block';
    advisorDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; color: #94a3b8;">
            <svg class="spin-icon" style="width: 14px; height: 14px; stroke: #00d2ff; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <span>Serverin boş resursları yoxlanılır...</span>
        </div>
    `;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`/api/servers/${serverId}/stats`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error("Stats fetch failed");
        const stats = await res.json();

        const freeRam = stats.total_ram_mb - stats.used_ram_mb;
        const freeCores = stats.cores;

        let recommendedRam = '256m';
        if (freeRam > 1000) recommendedRam = '512m';
        if (freeRam > 2000) recommendedRam = '1g';

        let recommendedCpu = '0.5';
        if (freeCores >= 2) recommendedCpu = '1';

        advisorDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg style="width: 13px; height: 13px; stroke: #00d2ff; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                        <span style="color: #f1f5f9; font-weight: 500; font-size: 0.82rem;">Serverin Cari Vəziyyəti:</span>
                    </div>
                    <div style="font-size: 0.78rem; color: #94a3b8; display: flex; gap: 12px; flex-wrap: wrap;">
                        <span>Boş RAM: <strong style="color: #00e676; font-weight: 500;">${freeRam} MB</strong> (Cəmi: ${stats.total_ram_mb} MB)</span>
                        <span>Nüvə: <strong style="color: #f1f5f9; font-weight: 500;">${stats.cores} Core</strong></span>
                    </div>
                    <div style="font-size: 0.74rem; color: #64748b; margin-top: 1px;">
                        Tövsiyə olunan limit: <strong style="color: #cbd5e1; font-weight: 500;">${recommendedRam}</strong> RAM, <strong style="color: #cbd5e1; font-weight: 500;">${recommendedCpu}</strong> CPU
                    </div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" style="padding: 0.35rem 0.85rem; font-size: 0.75rem; font-weight: 500; border: 1px solid rgba(0,210,255,0.3); color: #00d2ff; background: rgba(0,210,255,0.06); border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='rgba(0,210,255,0.15)'" onmouseout="this.style.background='rgba(0,210,255,0.06)'" onclick="
                    document.getElementById('${memInputId}').value = '${recommendedRam}';
                    document.getElementById('${cpuInputId}').value = '${recommendedCpu}';
                ">Tövsiyəni Tətbiq Et</button>
            </div>
        `;
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(e);
        }
        advisorDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: #fbbf24;">
                <svg style="width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17"/></svg>
                <span>Server məlumatları alına bilmədi. Serverin aktiv olduğuna əmin olun.</span>
            </div>
        `;
    }
}
let runtimeLogTimeout = null;

function stopRuntimeLogPolling() {
    if (runtimeLogTimeout) {
        clearTimeout(runtimeLogTimeout);
        runtimeLogTimeout = null;
    }
}

async function fetchRuntimeLogs(appId) {
    try {
        const res = await fetch(`/api/runtime-logs/${appId}`);
        if (res.ok) {
            const logs = await res.json();
            const liveTerminal = document.getElementById('live-terminal-body');
            const isNearBottom = liveTerminal.innerHTML === '' || liveTerminal.scrollHeight - liveTerminal.scrollTop <= liveTerminal.clientHeight + 50;
            liveTerminal.innerHTML = formatLogsToHtml(logs);
            if (isNearBottom) {
                liveTerminal.scrollTop = liveTerminal.scrollHeight;
            }
        }
    } catch (e) {
        console.error("Error fetching runtime logs:", e);
    }

    // Schedule next run only if polling is still active and it matches the current app
    const content = document.getElementById('live-content');
    if (content && (content.style.display === 'flex' || content.style.display === 'block') && appId === currentAppId) {
        stopRuntimeLogPolling(); // clear any previous scheduled timeout
        runtimeLogTimeout = setTimeout(() => fetchRuntimeLogs(appId), 3000);
    }
}

// Modify toggleAccordion to start/stop polling
const originalToggleAccordion = toggleAccordion;
toggleAccordion = function (contentId, headerElement) {
    originalToggleAccordion(contentId, headerElement);

    // If the live content was just opened, start polling runtime logs
    if (contentId === 'live-content') {
        const content = document.getElementById(contentId);
        if (content.style.display === 'flex' || content.style.display === 'block') {
            if (currentAppId) {
                stopRuntimeLogPolling();
                fetchRuntimeLogs(currentAppId);
            }
        } else {
            stopRuntimeLogPolling();
        }
    }
};

function downloadLogs(targetId = 'terminal-body', filename = 'logs.txt') {
    const el = document.getElementById(targetId);
    if (!el) return;
    const text = el.innerText || el.textContent || '';
    if (!text.trim()) {
        alert('Endirmək üçün heç bir loq tapılmadı!');
        return;
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Also modify copyTerminalLogs to handle specific IDs
function copyTerminalLogs(targetId = 'terminal-body') {
    const el = document.getElementById(targetId);
    if (!el) return;
    const text = el.innerText || el.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Loqlar kopyalandı');
        }).catch(err => {
            console.error('Kopyalama xətası:', err);
        });
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            alert('Loqlar kopyalandı');
        } catch (err) {
            console.error('Kopyalama xətası (fallback):', err);
        }
        document.body.removeChild(ta);
    }
}
let currentAppId = null;



let currentAppDetailsId = null;
let currentAppDetailsName = null;

async function openAppDetails(appId, autoSwitchToOverview = true) {
    console.time("[TIMER] openAppDetails TOTAL");
    console.log("[DEBUG] openAppDetails started for App:", appId);
    localStorage.setItem('active_app_id', appId);
    currentAppDetailsId = appId;
    try {
        console.time("[FETCH] Application Details");
        const res = await fetch(`/api/applications/${appId}`);
        console.timeEnd("[FETCH] Application Details");
        
        if (!res.ok) { alert('Layihə məlumatları yüklənmədi.'); return; }
        const app = await res.json();
        currentAppDetailsName = app.name;

        // Populate Header
        document.getElementById('detail-app-name').innerText = app.name;

        const statusColors = {
            'running': '#00e676', 'success': '#00e676',
            'failed': '#ff1744', 'deploying': '#00d2ff',
            'building': '#00d2ff', 'cancelled': '#ff9800', 'idle': '#9aa0a6',
            'stopped': '#757575'
        };
        const sc = statusColors[app.status] || '#9aa0a6';
        const statBadge = document.getElementById('detail-app-status');
        statBadge.innerText = app.status.toUpperCase();
        statBadge.style.color = sc;
        statBadge.style.background = sc + '20'; // transparent background
        statBadge.style.border = `1px solid ${sc}50`;

        // Check if there is an IP we can use to generate the link
        let serverIp = 'localhost';
        try {
            console.time("[FETCH] Server Details");
            const srvRes = await fetch(`/api/servers/${app.server_id}`);
            if (srvRes.ok) {
                const srv = await srvRes.json();
                serverIp = srv.ip;
                document.getElementById('detail-overview-server').innerText = srv.name + ' (' + srv.ip + ')';
            } else {
                document.getElementById('detail-overview-server').innerText = app.server_id;
            }
            console.timeEnd("[FETCH] Server Details");
        } catch (e) {
            console.timeEnd("[FETCH] Server Details");
            document.getElementById('detail-overview-server').innerText = app.server_id;
        }

        const resolvedIp = (serverIp === 'local' || serverIp === 'localhost') ? 'localhost' : serverIp;
        const appUrl = app.cf_worker_url ? app.cf_worker_url : `http://${resolvedIp}:${app.port}`;
        document.getElementById('detail-app-url').innerText = appUrl;
        document.getElementById('detail-app-link').href = appUrl;

        // Populate Overview
        document.getElementById('detail-overview-repo').innerText = app.repo_url || '-';
        document.getElementById('detail-overview-branch').innerText = app.branch || '-';
        document.getElementById('detail-overview-port').innerText = app.port || '-';

        // Populate Auto-Deploy Overview
        const adStatusEl = document.getElementById('detail-overview-autodeploy-status');
        if (adStatusEl) {
            if (app.auto_deploy_enabled === 1) {
                adStatusEl.innerHTML = '<span style="color: #00e676; display: inline-flex; align-items: center; gap: 4px;"><span style="width:7px;height:7px;border-radius:50%;background:#00e676;display:inline-block;"></span> Aktivdir</span>';
            } else {
                adStatusEl.innerHTML = '<span style="color: #94a3b8; display: inline-flex; align-items: center; gap: 4px;"><span style="width:7px;height:7px;border-radius:50%;background:#64748b;display:inline-block;"></span> Sönülüdür ⚪</span>';
            }
        }
        const adIntervalEl = document.getElementById('detail-overview-autodeploy-interval');
        if (adIntervalEl) {
            const intVal = app.auto_deploy_interval || 15;
            adIntervalEl.innerText = intVal >= 60 ? `${Math.round(intVal / 60)} saat` : `${intVal} dəqiqə`;
        }
        const adTimeoutEl = document.getElementById('detail-overview-autodeploy-timeout');
        if (adTimeoutEl) {
            adTimeoutEl.innerText = `${app.auto_deploy_timeout || 10} saniyə`;
        }
        const adLastEl = document.getElementById('detail-overview-autodeploy-last');
        if (adLastEl) {
            adLastEl.innerText = app.last_auto_deploy_check ? app.last_auto_deploy_check : 'Hələ yoxlanılmayıb';
        }

        // Populate Settings inputs using existing function but bypassing modal
        console.time("[CALL] openAppSettings");
        openAppSettings(appId, false); // false = don't show modal
        console.timeEnd("[CALL] openAppSettings");

        // Pending redeploy bayrağını yoxla
        const hasPending = localStorage.getItem(`pending_redeploy_${appId}`) === 'true';
        markRedeployPending(hasPending);

        // Deployments tarixçəsini yüklə
        console.time("[CALL] loadAppDeployments");
        loadAppDeployments(appId);
        console.timeEnd("[CALL] loadAppDeployments");

        switchTab('app-details');
        if (autoSwitchToOverview) {
            switchAppTab('overview');
        }

        // Re-render Lucide icons (some may be inside hidden sections)
        if (typeof lucide !== 'undefined') lucide.createIcons();

    } catch (e) {
        console.error("openAppDetails error", e);
    }
    console.timeEnd("[TIMER] openAppDetails TOTAL");
}

function switchAppTab(tabId) {
    localStorage.setItem('active_app_subtab', tabId);
    // Hide all subtab contents
    document.querySelectorAll('.subtab-content').forEach(el => el.style.display = 'none');
    // Remove active class from subtab buttons
    document.querySelectorAll('.subtab-btn').forEach(el => el.classList.remove('active'));

    // Show selected subtab (logs tab flex layout tələb edir)
    const selectedContent = document.getElementById(`subtab-${tabId}`);
    if (selectedContent) {
        selectedContent.style.display = tabId === 'logs' ? 'flex' : 'block';
    }

    // Set active button
    const selectedBtn = document.querySelector(`.subtab-btn[data-subtab="${tabId}"]`);
    if (selectedBtn) selectedBtn.classList.add('active');

    // Handle specific tab actions
    if (tabId === 'logs' && currentAppDetailsId) {
        // If switching to logs, and we aren't already viewing logs, we could fetch recent. 
        // For now, viewLogs sets up the intervals if an active deploy exists, otherwise just polls runtime logs.
        viewLogs(currentAppDetailsId, false); // false = don't switch main tabs
    } else {
        stopLogPolling();
        stopRuntimeLogPolling();
    }
}

function handleDeleteAppClick(event, appId, encodedName) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const appName = encodedName ? decodeURIComponent(encodedName) : 'Adsız Layihə';
    deleteApp(appId, appName);
}

function deleteAppFromDetails() {
    if (!currentAppDetailsId) return;
    const appName = currentAppDetailsName || 'Tətbiq';
    deleteApp(currentAppDetailsId, appName);
}

// ── Actions dropdown (More menu) ──────────────────────
function toggleActionsMenu() {
    const menu = document.getElementById('app-actions-dropdown');
    if (menu) menu.classList.toggle('open');
}
function closeActionsMenu() {
    const menu = document.getElementById('app-actions-dropdown');
    if (menu) menu.classList.remove('open');
}
// Close dropdown if user clicks outside of it
document.addEventListener('click', function(e) {
    const btn  = document.getElementById('btn-more-actions');
    const menu = document.getElementById('app-actions-dropdown');
    if (menu && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('open');
    }
});

// ── Initialize Lucide icons after DOM is ready ────────
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
});


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

// ─── Fəaliyyət Jurnalı & Canlı Debug Monitoru ──────────────────────────────
const LOG_ICONS = {
    deploy: { icon: '🚀', color: '#00d2ff', tagClass: 'term-tag-deploy', label: 'Deploy' },
    update: { icon: '🔄', color: '#7c3aed', tagClass: 'term-tag-info', label: 'Yenilənmə' },
    server: { icon: '🖥️', color: '#00e676', tagClass: 'term-tag-info', label: 'Server' },
    app: { icon: '📦', color: '#ff9800', tagClass: 'term-tag-info', label: 'Layihə' },
    error: { icon: '❌', color: '#ff1744', tagClass: 'term-tag-error', label: 'Xəta' },
    warning: { icon: '⚠️', color: '#ffb86c', tagClass: 'term-tag-warning', label: 'Xəbərdarlıq' },
    success: { icon: '✅', color: '#00e676', tagClass: 'term-tag-success', label: 'Uğurlu' },
    info: { icon: 'ℹ️', color: '#9aa0a6', tagClass: 'term-tag-info', label: 'Məlumat' },
    delete: { icon: '🗑️', color: '#ff1744', tagClass: 'term-tag-error', label: 'Silinmə' },
    setup: { icon: '⚙️', color: '#00e676', tagClass: 'term-tag-success', label: 'Qurulum' },
};

let activityLogsState = {
    allLogs: [],
    filteredLogs: [],
    levelFilter: 'all',
    moduleFilter: 'all',
    searchQuery: '',
    isStreaming: true,
    viewMode: 'cards', // 'cards' | 'terminal'
    autoScroll: true,
    pollInterval: null,
    lastHash: '',
    isFetching: false
};

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
        if (mod.includes('app') || mod.includes('layihə')) return 'apps';
        if (mod.includes('server')) return 'servers';
        if (mod.includes('deploy')) return 'deploy';
        if (mod.includes('system') || mod.includes('sistem')) return 'system';
    }
    const m = (log.message || '').toLowerCase();
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
    const { allLogs, levelFilter, moduleFilter, searchQuery } = activityLogsState;

    activityLogsState.filteredLogs = allLogs.filter(log => {
        const lvl = resolveLogLevel(log);
        const mod = resolveLogModule(log);

        if (levelFilter !== 'all' && lvl !== levelFilter) return false;
        if (moduleFilter !== 'all' && mod !== moduleFilter) return false;

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
                    <button onclick="copySingleLog(event, '${escapedMessage}')" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; font-size:0.95rem; padding:4px 6px; border-radius:4px; transition:color 0.2s;" onmouseover="this.style.color='var(--accent-color)'" onmouseout="this.style.color='var(--text-secondary)'" title="Kopyala">📋</button>
                    <span style="font-size:0.75rem; color:var(--text-secondary); font-family:monospace; opacity:0.85;">${timeStr}</span>
                </div>
            </div>`;
        }).join('');

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

// --- Debug mode outline details and copying system ---
function toggleDebugMode() {
    document.body.classList.toggle('debug-mode');
    const isDebug = document.body.classList.contains('debug-mode');
    localStorage.setItem('debug_mode', isDebug ? 'true' : 'false');
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
    if (isDebug) {
        document.body.classList.add('debug-mode');
        setTimeout(initDebugTooltips, 500);
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

// --- Modul (Plugins) Menecment Sistemi ---
let installedPlugins = {};

async function loadPlugins() {
    try {
        const res = await fetch('/api/plugins');
        const plugins = await res.json();
        const container = document.getElementById('plugins-list');
        if (!container || !Array.isArray(plugins)) return;

        container.innerHTML = plugins.map(p => {
            installedPlugins[p.id] = p.installed;
            const isCf = p.id === 'cloudflare';
            return `
            <div class="plugin-card" style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); border: 1px solid var(--card-border); padding: 15px; border-radius: 12px; margin-bottom: 8px;">
                <div class="plugin-info-block">
                    <h3 style="margin: 0 0 5px 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">${p.name} <span class="plugin-version" style="font-size: 0.8rem; opacity: 0.6; font-family: monospace;">v${p.version}</span> ${isCf ? `<span onclick="openCloudflareHelpModal()" style="cursor: pointer; font-size: 0.72rem; background: rgba(0, 210, 255, 0.1); color: var(--accent-color); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(0, 210, 255, 0.2); font-weight: 600; display: inline-flex; align-items: center; gap: 3px;" title="Quraşdırma Təlimatı">❓ Təlimat</span>` : ''}</h3>
                    <p style="margin: 0; font-size: 0.85rem; color: var(--text-secondary);">${p.description}</p>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${isCf && p.installed ? `<span id="cf-plugin-status-badge" style="color: #ffb86c; font-size: 0.8rem; margin-right: 10px; font-weight: 500;">🟡 Yoxlanılır...</span>` : ''}
                    ${p.installed ?
                    `
                         ${isCf ? `<button class="btn btn-secondary" onclick="openCloudflareSetupModal()" style="padding: 6px 12px; font-size: 0.8rem; border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;">⚙️ Sazla</button>` : ''}
                         <button class="btn btn-secondary" onclick="uninstallPlugin('${p.id}')" style="color: var(--danger-color) !important; padding: 6px 12px; font-size: 0.8rem;">Uninstall</button>
                        ` :
                    `<button class="btn btn-primary" onclick="installPlugin('${p.id}')" style="padding: 6px 12px; font-size: 0.8rem;">Install</button>`
                }
                </div>
            </div>
            `;
        }).join('');

        // Cloudflare qoşulma statusunu arxa fonda ayrıca yoxlayıb yeniləyirik
        const cfPlugin = plugins.find(p => p.id === 'cloudflare');
        if (cfPlugin && cfPlugin.installed) {
            fetch('/api/plugins/cloudflare/check')
                .then(r => r.json())
                .then(checkData => {
                    const badge = document.getElementById('cf-plugin-status-badge');
                    if (badge) {
                        if (checkData.status === 'connected') {
                            badge.innerHTML = '🟢 Qoşulma aktivdir';
                            badge.style.color = '#00e676';
                        } else if (checkData.status === 'incomplete') {
                            badge.innerHTML = '🟡 Konfiqurasiya edilməyib';
                            badge.style.color = '#ffb86c';
                        } else {
                            badge.innerHTML = '🔴 Bağlantı xətası';
                            badge.style.color = '#ff5555';
                        }
                    }
                })
                .catch(() => {
                    const badge = document.getElementById('cf-plugin-status-badge');
                    if (badge) {
                        badge.innerHTML = '🔴 Bağlantı xətası';
                        badge.style.color = '#ff5555';
                    }
                });
        }
    } catch (e) {
        console.error("Failed to load plugins", e);
    }
}

async function installPlugin(id) {
    const card = event.target.closest('.plugin-card');
    const btnContainer = event.target.parentElement;
    btnContainer.innerHTML = `<span class="plugin-loading-spinner"></span> <span style="font-size:0.8rem; color:var(--text-secondary);">Quraşdırılır...</span>`;

    try {
        const res = await fetch(`/api/plugins/${id}/install`, { method: 'POST' });
        if (res.ok) {
            setTimeout(async () => {
                await loadPlugins();
                loadApplications();
                addActivityLog(`Modul quraşdırıldı: ${id}`, 'setup');
                if (id === 'cloudflare') {
                    // Avtomatik sazlama pəncərəsi açılsın
                    openCloudflareSetupModal();
                }
            }, 1500); // Vizual gözəllik üçün animasiyanı 1.5s saxlayırıq
        }
    } catch (e) {
        console.error(e);
    }
}

async function uninstallPlugin(id) {
    const card = event.target.closest('.plugin-card');
    const btnContainer = event.target.parentElement;
    btnContainer.innerHTML = `<span class="plugin-loading-spinner" style="border-top-color:var(--danger-color);"></span> <span style="font-size:0.8rem; color:var(--text-secondary);">Silinir...</span>`;

    try {
        const res = await fetch(`/api/plugins/${id}/uninstall`, { method: 'POST' });
        if (res.ok) {
            setTimeout(async () => {
                await loadPlugins();
                loadApplications();
                addActivityLog(`Modul silindi: ${id}`, 'delete');
            }, 1500);
        }
    } catch (e) {
        console.error(e);
    }
}

function openCloudflareHelpModal() {
    const template = document.getElementById('worker-code-template');
    if (template) {
        const appName = currentAppDetailsName || "yeni-test";
        template.innerHTML = `export default {
  async fetch(request, env, ctx) {
    // Layihə adı DƏQİQ MasterDeploy panelindəki ilə eyni olmalıdır
    const APP_NAME = "${appName}"; 

    // KV-dən canlı linki oxuyuruq
    const liveUrl = await env.TUNNEL_DB.get(appName);

    if (!liveUrl) {
      return new Response(\`[MasterDeploy] '\${APP_NAME}' üçün aktiv tünel tapılmadı. Zəhmət olmasa panelinizdən tüneli başladın.\`, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=UTF-8" }
      });
    }

    // Sorğunu canlı linkə yönləndiririk
    const url = new URL(request.url);
    const targetUrl = url.href.replace(url.origin, liveUrl.trim());

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual'
    });

    return fetch(modifiedRequest);
  }
}`;
    }
    showModal('cloudflare-help-modal');
}

function copyWorkerCodeToClipboard(btn) {
    const code = document.getElementById('worker-code-template').innerText;
    navigator.clipboard.writeText(code).then(() => {
        const origText = btn.innerHTML;
        btn.innerHTML = '✅ Kopyalandı!';
        btn.style.background = '#00e676';
        btn.style.color = '#fff';
        setTimeout(() => {
            btn.innerHTML = origText;
            btn.style.background = 'var(--accent-color)';
            btn.style.color = '#000';
        }, 2000);
    }).catch(err => {
        console.error('Kopyalama xətası:', err);
    });
}

// Cloudflare Modulu üçün Sazlama Funksiyaları
async function openCloudflareSetupModal() {
    try {
        const res = await fetch('/api/plugins/cloudflare/settings');
        if (res.ok) {
            const settings = await res.json();
            document.getElementById('cf-api-token').value = settings.api_token || '';
            document.getElementById('cf-account-id').value = settings.account_id || '';
            document.getElementById('cf-kv-id').value = settings.kv_id || '';
        }
    } catch (e) {
        console.error("Failed to load Cloudflare settings", e);
    }

    showModal('cloudflare-setup-modal');
    checkCloudflareConnection();
}

async function checkCloudflareConnection() {
    const indicator = document.getElementById('cf-connection-indicator');
    const text = document.getElementById('cf-connection-text');

    if (indicator && text) {
        indicator.className = 'status-indicator';
        indicator.style.background = '#ffb86c';
        text.innerText = 'Yoxlanılır...';
        text.style.color = '#ffb86c';
    }

    try {
        const res = await fetch('/api/plugins/cloudflare/check');
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'connected') {
                indicator.className = 'status-indicator online';
                indicator.style.background = '#00e676';
                text.innerText = 'Qoşulma aktivdir 🟢';
                text.style.color = '#00e676';
            } else if (data.status === 'incomplete') {
                indicator.className = 'status-indicator offline';
                indicator.style.background = '#ffb86c';
                text.innerText = 'Konfiqurasiya məlumatları tam doldurulmayıb.';
                text.style.color = '#ffb86c';
            } else {
                indicator.className = 'status-indicator offline';
                indicator.style.background = '#ff5555';
                text.innerText = data.message || 'Bağlantı xətası!';
                text.style.color = '#ff5555';
            }
        }
    } catch (e) {
        if (indicator && text) {
            indicator.className = 'status-indicator offline';
            indicator.style.background = '#ff5555';
            text.innerText = 'Şəbəkə xətası!';
            text.style.color = '#ff5555';
        }
    }
}

async function submitCloudflareSettings() {
    const api_token = document.getElementById('cf-api-token').value.trim();
    const account_id = document.getElementById('cf-account-id').value.trim();
    const kv_id = document.getElementById('cf-kv-id').value.trim();

    try {
        const res = await fetch('/api/plugins/cloudflare/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_token, account_id, kv_id, worker_url: "" })
        });
        if (res.ok) {
            alert('Sazlamalar uğurla yadda saxlanıldı!');
            await checkCloudflareConnection();
            loadPlugins();
        } else {
            alert('Sazlamaları yadda saxlamaq mümkün olmadı.');
        }
    } catch (e) {
        alert('Xəta baş verdi: ' + e.message);
    }
}

async function deployCloudflareWorker(appId) {
    if (!appId) { alert('Tətbiq ID tapılmadı.'); return; }
    const btn = document.getElementById('btn-deploy-cf-worker');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⌛ Yüklənir...';

    try {
        const res = await fetch(`/api/plugins/cloudflare/deploy-worker/${appId}`, {
            method: 'POST'
        });
        if (res.ok) {
            const data = await res.json();
            alert('Cloudflare Worker uğurla deploy edildi!');
            if (data.worker_url) {
                const urlInput = document.getElementById('settings-cf-worker-url');
                if (urlInput) urlInput.value = data.worker_url;
                
                const detailUrlSpan = document.getElementById('detail-app-url');
                const detailLink = document.getElementById('detail-app-link');
                if (detailUrlSpan) detailUrlSpan.innerText = data.worker_url;
                if (detailLink) detailLink.href = data.worker_url;
            }
            if (typeof loadApplications === 'function') loadApplications();
        } else {
            const errText = await res.text();
            alert('Worker deploy xətası: ' + errText);
        }
    } catch (e) {
        alert('Xəta baş verdi: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

async function deleteCloudflareWorker(appId) {
    if (!appId) { alert('Tətbiq ID tapılmadı.'); return; }
    if (!confirm('Bu tətbiqin Cloudflare Worker-ini və sabit linkini silmək istədiyinizdən əminsiniz?')) return;
    
    const btn = document.getElementById('btn-delete-cf-worker');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⌛ Silinir...';

    try {
        const res = await fetch(`/api/plugins/cloudflare/delete-worker/${appId}`, {
            method: 'POST'
        });
        if (res.ok) {
            alert('Cloudflare Worker uğurla silindi!');
            const urlInput = document.getElementById('settings-cf-worker-url');
            if (urlInput) urlInput.value = '';
            
            if (typeof openAppDetails === 'function') {
                openAppDetails(appId, false);
            }
            if (typeof loadApplications === 'function') loadApplications();
        } else {
            const errText = await res.text();
            alert('Worker silmə xətası: ' + errText);
        }
    } catch (e) {
        alert('Xəta baş verdi: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// 3 xətt menyusunu açmaq
function toggleAppMenu(event, appId) {
    event.stopPropagation();
    // Bütün digər açıq menyuları bağla və z-indexləri sıfırla
    document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
    document.querySelectorAll('.list-item').forEach(item => item.style.zIndex = 'auto');

    const menu = document.getElementById(`app-menu-${appId}`);
    if (menu) {
        const isClosed = menu.style.display === 'none' || menu.style.display === '';
        if (isClosed) {
            menu.style.display = 'flex';
            const listItem = menu.closest('.list-item');
            if (listItem) {
                listItem.style.zIndex = '1000';
            }
        } else {
            menu.style.display = 'none';
        }
    }
}

// Global click event ilə drop menyularını kənara basanda bağlamaq
document.addEventListener('click', () => {
    document.querySelectorAll('.app-dropdown-menu').forEach(m => m.style.display = 'none');
    document.querySelectorAll('.list-item').forEach(item => item.style.zIndex = 'auto');
});

// Modallar açılanda pluginləri yüklə
const originalShowModal = showModal;
showModal = function (id) {
    originalShowModal(id);
    if (id === 'plugins-modal') {
        loadPlugins();
    }
};

// ESC düyməsi ilə ən öndəki (aktiv) pəncərəni bağlamaq
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        let topWindowId = null;
        let maxZ = -1;
        Object.keys(activeWindows).forEach(winId => {
            if (activeWindows[winId] && !minimizedWindows[winId]) {
                const backdrop = document.getElementById(winId);
                if (backdrop) {
                    const card = backdrop.querySelector('.modal-card');
                    if (card) {
                        const z = parseInt(card.style.zIndex) || 0;
                        if (z > maxZ) {
                            maxZ = z;
                            topWindowId = winId;
                        }
                    }
                }
            }
        });
        if (topWindowId) {
            closeModal(topWindowId);
        }
    }
});

function fitTerminalHeight() {
    // Flexbox handles terminal height cleanly and reliably
}

// ── Custom Searchable Repo Dropdown for Settings ───────────────────────────────
function showSettingsRepoDropdown() {
    const listEl = document.getElementById('settings-repo-dropdown-list');
    if (listEl) {
        listEl.style.display = 'block';
        renderSettingsRepoList(gitHubRepos);
    }
}

function filterSettingsRepos(val) {
    const filtered = gitHubRepos.filter(r => r.full_name.toLowerCase().includes(val.toLowerCase()));
    renderSettingsRepoList(filtered);
}

function selectSettingsRepo(fullName) {
    const searchInput = document.getElementById('settings-repo-search');
    const urlInput = document.getElementById('settings-repo-url');
    if (searchInput) searchInput.value = fullName;
    if (urlInput) urlInput.value = 'https://github.com/' + fullName;
    
    const listEl = document.getElementById('settings-repo-dropdown-list');
    if (listEl) listEl.style.display = 'none';
}

function renderSettingsRepoList(repos) {
    const listEl = document.getElementById('settings-repo-dropdown-list');
    if (!listEl) return;
    if (repos.length === 0) {
        listEl.innerHTML = '<div style="padding:10px; color:var(--text-secondary); text-align:center; font-size:0.9rem;">Heç bir repo tapılmadı</div>';
        return;
    }
    listEl.innerHTML = repos.map(repo => {
        const isPrivate = repo.private ? "🔒" : "🔓";
        return `
            <div onclick="selectSettingsRepo('${repo.full_name}')" style="padding:10px 15px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.02); display:flex; align-items:center; justify-content:space-between; transition:background 0.2s; font-size:0.92rem;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                <span style="color:#f5f5f7; display:flex; align-items:center; gap:8px;">${isPrivate} ${repo.full_name}</span>
                <span style="font-size:0.8rem; padding:2px 6px; border-radius:4px; background:${repo.private ? 'rgba(235,94,85,0.1)' : 'rgba(46,204,113,0.1)'}; color:${repo.private ? '#eb5e55' : '#2ecc71'};">${repo.private ? 'Private' : 'Public'}</span>
            </div>
        `;
    }).join('');
}

// Close settings repo dropdown on click outside
document.addEventListener('click', function(e) {
    const list = document.getElementById('settings-repo-dropdown-list');
    const search = document.getElementById('settings-repo-search');
    if (list && search && !search.contains(e.target) && !list.contains(e.target)) {
        list.style.display = 'none';
    }
});

// --- SSH Keys Management UI JS Logic ---
// --- SSH Keys Management UI JS Logic (Modularized in keys_tokens.js) ---

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

// --- Keys & Tokens Modular UI ---
async function loadKeysTokensModularUI() {
    if (typeof initKeysTokens === 'function') {
        initKeysTokens();
    }
}
