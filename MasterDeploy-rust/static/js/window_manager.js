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

// Pəncərənin ekran hüdudlarından (xüsusilə yuxarıdan və kənarlardan) kənara qaçmasının qarşısını alan funksiya
function clampWindowToScreen(card) {
    if (!card || card.classList.contains('maximized')) return;
    const headerHeight = 42;
    const minTop = 15;
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;

    // Mövcud koordinatlar
    let top = card.offsetTop;
    let left = card.offsetLeft;
    const width = card.offsetWidth || 530;
    const height = card.offsetHeight || 400;

    // Yuxarı başlıq heç vaxt ekrandan yuxarıda gizlənə bilməz
    if (top < minTop || isNaN(top)) {
        top = minTop;
    }
    // Aşağı taskbar-ın altına düşə bilməz
    if (top > winHeight - headerHeight - 30) {
        top = Math.max(minTop, winHeight - headerHeight - 50);
    }

    // Sağa və ya sola tam qaçmasının qarşısını al
    const minVisible = 120;
    if (left + width < minVisible) {
        left = minVisible - width;
    }
    if (left > winWidth - minVisible) {
        left = winWidth - minVisible;
    }

    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
}

// İstənilən pəncərəni tən ortada bərpa etmə (Emergency Center Reset)
function centerWindow(windowId) {
    const backdrop = document.getElementById(windowId);
    if (!backdrop) return;
    const card = backdrop.querySelector('.modal-card');
    if (!card) return;

    card.classList.remove('maximized');
    card.style.width = card.dataset.prevWidth || (window.innerWidth < 700 ? '94vw' : '650px');
    card.style.height = 'auto';
    card.style.borderRadius = '16px';
    
    // Mərkəzə yerləşdir
    const cardWidth = card.offsetWidth || 650;
    const cardHeight = card.offsetHeight || 450;
    const left = Math.max(15, Math.floor((window.innerWidth - cardWidth) / 2));
    const top = Math.max(25, Math.floor((window.innerHeight - cardHeight) / 2.5));

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    saveWindowPosition(windowId, card);
    clampWindowToScreen(card);
    bringToFront(windowId);
    showToast('Pəncərə mövqeyi mərkəzə qaytarıldı', 'info');
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
    // Həmişə təhlükəsizlik üçün ekran hüdudlarını yoxla
    setTimeout(() => clampWindowToScreen(card), 10);
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
async function restoreDesktopWindowsState() {
    try {
        const raw = localStorage.getItem('desktop_windows_state');
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state || !Array.isArray(state.active) || state.active.length === 0) return;

        if (typeof ensureModalsLoaded === 'function') {
            await ensureModalsLoaded();
        }

        for (const winId of state.active) {
            const backdrop = document.getElementById(winId);
            if (backdrop) {
                await showModal(winId);
                if (state.maximized && state.maximized.includes(winId)) {
                    maximizeWindow(winId);
                }
                if (state.minimized && state.minimized.includes(winId)) {
                    minimizeWindow(winId);
                }
            }
        }
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
            const minVisibleSide = 120;
            
            if (nextTop < 15) nextTop = 15; // Başlıq heç vaxt ekranın yuxarı qırağına yapışıb gizlənə bilməz
            if (nextTop > window.innerHeight - headerHeight - 35) nextTop = window.innerHeight - headerHeight - 35; // Taskbar altına düşə bilməz
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

        btn.title = "Sol klik: Gizlət / Göstər | Sağ klik: Ekranın mərkəzinə gətir";

        btn.onclick = () => {
            if (isMin) {
                restoreWindow(winId);
                const b = document.getElementById(winId);
                const c = b ? b.querySelector('.modal-card') : null;
                if (c) clampWindowToScreen(c);
            } else {
                minimizeWindow(winId);
            }
        };

        // Sağ klik ilə itmiş və ya kənarda qalmış pəncərəni dərhal mərkəzə qaytar
        btn.oncontextmenu = (e) => {
            e.preventDefault();
            if (isMin) restoreWindow(winId);
            centerWindow(winId);
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

let modalsLoaded = false;
let modalsLoadingPromise = null;

async function ensureModalsLoaded() {
    if (modalsLoaded || document.getElementById('server-modal')) {
        modalsLoaded = true;
        return true;
    }
    if (modalsLoadingPromise) return modalsLoadingPromise;

    modalsLoadingPromise = (async () => {
        try {
            const resp = await fetch(`/modals/all_modals.html?v=${Date.now()}`);
            if (!resp.ok) throw new Error(`Status ${resp.status}`);
            const html = await resp.text();
            const container = document.getElementById('dynamic-modals-container');
            if (container) {
                container.innerHTML = html;
                modalsLoaded = true;
                if (window.lucide && typeof lucide.createIcons === 'function') {
                    lucide.createIcons();
                }
                return true;
            }
        } catch (e) {
            console.error('Modallar yüklənərkən xəta:', e);
        } finally {
            modalsLoadingPromise = null;
        }
        return false;
    })();

    return modalsLoadingPromise;
}

// Modal management
async function showModal(id) {
    if (!document.getElementById(id)) {
        await ensureModalsLoaded();
    }
    const backdrop = document.getElementById(id);
    if (!backdrop) return;

    backdrop.classList.add('active');
    backdrop.style.display = 'flex';

    const name = windowNames[id] || '💻 Pəncərə';
    initializeWindow(id, name);
    const card = backdrop.querySelector('.modal-card');
    if (card) {
        applySavedPosition(id, card);
        setTimeout(() => clampWindowToScreen(card), 20);
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

    // Alt + R (və ya Ctrl + Alt + C): Aktiv pəncərəni dərhal mərkəzə bərpa et
    if ((e.altKey && (e.key === 'r' || e.key === 'R')) || (e.ctrlKey && e.altKey && (e.key === 'c' || e.key === 'C'))) {
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
            e.preventDefault();
            centerWindow(topWindowId);
        }
    }
});

// Brauzer və ya monitor ölçüsü dəyişdikdə bütün aktiv pəncərələri avtomatik ekran hüdudlarına qaytar
window.addEventListener('resize', () => {
    Object.keys(activeWindows).forEach(winId => {
        if (activeWindows[winId] && !minimizedWindows[winId]) {
            const backdrop = document.getElementById(winId);
            if (backdrop) {
                const card = backdrop.querySelector('.modal-card');
                if (card) {
                    clampWindowToScreen(card);
                }
            }
        }
    });
});

function fitTerminalHeight() {
    // Flexbox handles terminal height cleanly and reliably
}
