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

const loadedTabs = new Set(['dashboard']);
const tabFilesMap = {
    'dashboard': 'dashboard.html',
    'servers': 'servers.html',
    'keys-tokens': 'keys_tokens.html',
    'applications': 'applications.html',
    'app-details': 'app_details.html',
    'background-services': 'background_services.html'
};

async function ensureTabLoaded(tabId) {
    if (document.getElementById(`tab-${tabId}`)) return true;
    const fileName = tabFilesMap[tabId];
    if (!fileName) return false;

    try {
        const resp = await fetch(`/tabs/${fileName}?v=${Date.now()}`);
        if (!resp.ok) throw new Error(`Status ${resp.status}`);
        const html = await resp.text();
        const main = document.querySelector('.main-content');
        if (main) {
            main.insertAdjacentHTML('beforeend', html);
            loadedTabs.add(tabId);
            if (window.lucide && typeof lucide.createIcons === 'function') {
                lucide.createIcons();
            }
            return true;
        }
    } catch (e) {
        console.error(`Tab yüklənərkən xəta (${tabId}):`, e);
    }
    return false;
}

async function switchTab(tabId) {
    if (tabId === 'autodeploy') {
        tabId = 'background-services';
    }
    localStorage.setItem('active_tab', tabId);

    // Update nav buttons active state
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Remove initial tab lock if present
    const initLock = document.getElementById('initial-tab-lock');
    if (initLock) initLock.remove();

    // Ensure tab content is loaded
    await ensureTabLoaded(tabId);

    // Update tab sections visibility
    document.querySelectorAll('.tab-section').forEach(section => {
        section.classList.remove('active');
        section.style.setProperty('display', 'none', 'important');
    });

    const targetSection = document.getElementById(`tab-${tabId}`);
    if (targetSection) {
        targetSection.classList.add('active');
        targetSection.style.setProperty('display', 'flex', 'important');
        targetSection.style.setProperty('flex-direction', 'column', 'important');
        targetSection.style.setProperty('flex', '1', 'important');
        targetSection.style.setProperty('min-height', '0', 'important');
    }

    // Trigger tab-specific loaders
    if (tabId === 'background-services') {
        if (typeof switchBgSubTab === 'function') {
            switchBgSubTab(currentBgSubTab || 'autodeploy');
        }
    } else if (tabId === 'applications') {
        if (typeof loadApplications === 'function') loadApplications();
    } else if (tabId === 'servers') {
        if (typeof loadServers === 'function') loadServers();
    } else if (tabId === 'keys-tokens') {
        if (typeof initKeysTokens === 'function') initKeysTokens();
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}


