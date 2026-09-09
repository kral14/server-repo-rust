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
    if (typeof ensureModalsLoaded === 'function') ensureModalsLoaded();
    initTabs();
    loadServers();
    if (typeof initKeysTokens === 'function') initKeysTokens();
    loadApplications();
    loadGithubToken();
    resetEnvVarsContainer();
    fetchAppVersion();
    renderActivityLogs();

    // Topbar Kontekstual Axtarış Qutusunun Tənzimlənməsi (Brauzer şifrə/login avtodoldurmasından 100% azad)
    const searchInp = document.getElementById('topbar-context-search');
    if (searchInp) {
        if (!Object.getOwnPropertyDescriptor(searchInp, 'value')) {
            Object.defineProperty(searchInp, 'value', {
                get() {
                    return (this.innerText || '').replace(/[\r\n]+/g, ' ').trim();
                },
                set(val) {
                    this.innerText = val || '';
                    if (!val) this.innerHTML = '';
                    const clearBtn = document.getElementById('topbar-search-clear-btn');
                    if (clearBtn) clearBtn.style.display = val ? 'block' : 'none';
                },
                configurable: true
            });
        }
        if (!Object.getOwnPropertyDescriptor(searchInp, 'placeholder')) {
            Object.defineProperty(searchInp, 'placeholder', {
                get() {
                    return this.getAttribute('data-placeholder') || '';
                },
                set(val) {
                    this.setAttribute('data-placeholder', val || '');
                },
                configurable: true
            });
        }

        // İlkin təmizlik
        searchInp.value = '';

        // İstifadəçi daxilində yazdıqda dərhal axtarış işə düşsün
        searchInp.addEventListener('input', () => {
            const val = searchInp.value;
            if (!val) searchInp.innerHTML = '';
            if (typeof onHeaderContextSearch === 'function') {
                onHeaderContextSearch(val);
            }
        });

        // Enter basıldıqda yeni sətir yaratmasın
        searchInp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                searchInp.blur();
            }
        });

        // Kopyalanıb yapışdırıldıqda yalnız sadə mətn kimi qəbul etsin
        searchInp.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            document.execCommand('insertText', false, text);
        });

        // Əlavə qoruyucu timer: kənar avtodoldurma cəhdi olarsa silinsin
        let killCount = 0;
        const killTimer = setInterval(() => {
            if (searchInp.value.includes('@')) {
                searchInp.value = '';
                if (typeof onHeaderContextSearch === 'function') onHeaderContextSearch('');
            }
            killCount++;
            if (killCount > 30) clearInterval(killTimer);
        }, 80);
    }

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
            switchTab('app-details').then(() => {
                if (typeof openAppDetails === 'function') {
                    openAppDetails(appId, false);
                }
                if (typeof switchAppTab === 'function') {
                    switchAppTab(subTab);
                }
            });
        } else {
            switchTab('applications');
        }
    } else {
        switchTab(activeTab);
    }

    // Səhifə yenilənəndə əvvəl açıq olan bütün pəncərələri avtomatik bərpa edirik
    setTimeout(restoreDesktopWindowsState, 150);

    // Sidebar Collapse / Expand Toggle Logic (İki dəfə kliklədikdə açılır / yığılır)
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
        const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
            document.documentElement.classList.add('sidebar-is-collapsed');
        }

        sidebar.addEventListener('dblclick', () => {
            sidebar.classList.toggle('collapsed');
            const nowCollapsed = sidebar.classList.contains('collapsed');
            localStorage.setItem('sidebar_collapsed', nowCollapsed ? 'true' : 'false');
            document.documentElement.classList.toggle('sidebar-is-collapsed', nowCollapsed);
            if (typeof showToast === 'function') {
                showToast(nowCollapsed ? 'Menyu yığıldı (Yalnız ikonlar) ◀' : 'Menyu genişləndirildi ▶', 'info');
            }
        });
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
    const btn = document.getElementById('theme-toggle-btn');
    const text = document.getElementById('theme-text');
    if (theme === 'light') {
        if (icon) icon.innerHTML = '<i data-lucide="moon" style="width: 14px; height: 14px; color: #38bdf8;"></i>';
        if (text) text.innerText = 'Qara Tema';
        if (btn) btn.title = 'Qara Temaya keç';
    } else {
        if (icon) icon.innerHTML = '<i data-lucide="sun" style="width: 14px; height: 14px; color: #fbbf24;"></i>';
        if (text) text.innerText = 'Açıq Tema';
        if (btn) btn.title = 'Açıq Temaya keç';
    }
    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
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

// Tab Switching Logic (Orijinal Tam Səhifə Rejimi)
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

    // Əgər həmin tab hazırda pəncərə daxilindədirsə, pəncərəni bağlayıb əsas səhifəyə qaytarırıq
    const winId = 'win-' + tabId;
    if (typeof closeModal === 'function') {
        closeModal(winId);
    }
    const targetSection = document.getElementById(`tab-${tabId}`);
    const mainContent = document.querySelector('.main-content');
    if (targetSection && mainContent && targetSection.parentElement !== mainContent) {
        mainContent.appendChild(targetSection);
    }

    // Update nav buttons active state
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update topbar quick-nav chips active state
    const tabNamesMap = {
        'dashboard': 'Dashboard',
        'servers': 'Serverlər',
        'applications': 'Layihələr',
        'background-services': 'Auto-Deploy',
        'keys-tokens': 'Açarlar',
        'app-details': 'Layihə Detalları'
    };
    const activeTitle = tabNamesMap[tabId] || tabId;
    const topbarBadge = document.getElementById('topbar-active-title');
    if (topbarBadge) topbarBadge.innerText = activeTitle;

    document.querySelectorAll('.topbar-nav-chip').forEach(chip => {
        if (chip.getAttribute('data-topbar-tab') === tabId) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });

    // Remove initial tab lock if present
    const initLock = document.getElementById('initial-tab-lock');
    if (initLock) initLock.remove();

    // Ensure tab content is loaded
    await ensureTabLoaded(tabId);

    // Update tab sections visibility
    document.querySelectorAll('.main-content > .tab-section').forEach(section => {
        section.classList.remove('active');
        section.style.setProperty('display', 'none', 'important');
    });

    const activeSec = document.getElementById(`tab-${tabId}`);
    if (activeSec && activeSec.parentElement === mainContent) {
        activeSec.classList.add('active');
        activeSec.style.setProperty('display', 'flex', 'important');
        activeSec.style.setProperty('flex-direction', 'column', 'important');
        activeSec.style.setProperty('flex', '1', 'important');
        activeSec.style.setProperty('min-height', '0', 'important');
    }

    // Trigger tab-specific loaders
    if (tabId === 'background-services') {
        if (typeof switchBgSubTab === 'function') {
            const savedBgSub = localStorage.getItem('active_bg_subtab') || (typeof currentBgSubTab !== 'undefined' ? currentBgSubTab : 'autodeploy');
            switchBgSubTab(savedBgSub);
        }
    } else {
        if (typeof stopTunnelAutoSync === 'function') stopTunnelAutoSync();
        if (tabId === 'applications') {
            if (typeof loadApplications === 'function') loadApplications();
        } else if (tabId === 'servers') {
            if (typeof loadServers === 'function') loadServers();
        } else if (tabId === 'keys-tokens') {
            if (typeof initKeysTokens === 'function') initKeysTokens();
        }
    }

    // Update Context Search Placeholder & re-apply current search if active
    if (typeof updateHeaderSearchPlaceholder === 'function') {
        updateHeaderSearchPlaceholder(tabId);
    }
    const curSearchVal = document.getElementById('topbar-context-search')?.value;
    if (curSearchVal && typeof onHeaderContextSearch === 'function') {
        setTimeout(() => onHeaderContextSearch(curSearchVal), 150);
    }

    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

// ==========================================================================
// Qlobal Kontekstual Axtarış Sistemi (Header Search Bar)
// ==========================================================================
function onHeaderContextSearch(query) {
    const q = (query || '').trim().toLowerCase();
    const clearBtn = document.getElementById('topbar-search-clear-btn');
    if (clearBtn) {
        clearBtn.style.display = q ? 'block' : 'none';
    }

    const activeTab = localStorage.getItem('active_tab') || 'dashboard';

    // 1. Arxa Plan və Auto-Deploy (background-services)
    if (activeTab === 'background-services') {
        const bgSub = localStorage.getItem('active_bg_subtab') || 'autodeploy';
        if (bgSub === 'tunnels') {
            const appRows = document.querySelectorAll('.tunnel-app-row');
            const tunnelCards = document.querySelectorAll('.tunnel-card-item');
            const vmCards = document.querySelectorAll('.tunnel-vm-card');

            if (!q) {
                appRows.forEach(r => r.style.display = 'flex');
                tunnelCards.forEach(t => t.style.display = 'flex');
                vmCards.forEach(v => v.style.display = 'block');
                return;
            }

            vmCards.forEach(vm => {
                let vmHasMatch = false;
                const vmName = vm.getAttribute('data-vm-name') || '';
                const vmIp = vm.getAttribute('data-vm-ip') || '';
                if (vmName.includes(q) || vmIp.includes(q)) {
                    vmHasMatch = true;
                }

                const tCards = vm.querySelectorAll('.tunnel-card-item');
                tCards.forEach(tc => {
                    let tcHasMatch = false;
                    const tcName = tc.getAttribute('data-tunnel-name') || '';
                    if (tcName.includes(q)) {
                        tcHasMatch = true;
                    }

                    const rows = tc.querySelectorAll('.tunnel-app-row');
                    let anyRowMatch = false;
                    rows.forEach(row => {
                        const key = (row.getAttribute('data-search-key') || '').toLowerCase();
                        if (key.includes(q) || vmHasMatch || tcHasMatch) {
                            row.style.display = 'flex';
                            anyRowMatch = true;
                        } else {
                            row.style.display = 'none';
                        }
                    });

                    if (tcHasMatch || anyRowMatch || vmHasMatch) {
                        tc.style.display = 'flex';
                        vmHasMatch = true;
                    } else {
                        tc.style.display = 'none';
                    }
                });

                vm.style.display = vmHasMatch ? 'block' : 'none';
            });
            return;
        } else if (bgSub === 'autodeploy') {
            const input = document.getElementById('autodeploy-search-input');
            if (input) {
                input.value = query;
                if (typeof filterAutoDeployApps === 'function') filterAutoDeployApps();
            }
            return;
        } else if (bgSub === 'logs') {
            const searchInput = document.getElementById('bg-activity-search');
            if (searchInput) {
                searchInput.value = query;
                if (typeof filterBgActivityLogs === 'function') filterBgActivityLogs();
            }
            return;
        }
    }

    // 2. Layihələr (Applications)
    if (activeTab === 'applications') {
        const appItems = document.querySelectorAll('#apps-list .list-item, #apps-list .app-row');
        appItems.forEach(item => {
            const text = (item.innerText || '').toLowerCase();
            item.style.display = (!q || text.includes(q)) ? 'block' : 'none';
        });
        return;
    }

    // 3. Serverlər (Servers)
    if (activeTab === 'servers') {
        const srvItems = document.querySelectorAll('#servers-list .card, #servers-list .server-card');
        srvItems.forEach(item => {
            const text = (item.innerText || '').toLowerCase();
            item.style.display = (!q || text.includes(q)) ? 'block' : 'none';
        });
        return;
    }

    // 4. Açarlar (Keys & Tokens)
    if (activeTab === 'keys-tokens') {
        const keysInput = document.getElementById('coolify-search-keys');
        if (keysInput) {
            keysInput.value = query;
            if (typeof filterCoolifyKeys === 'function') filterCoolifyKeys();
        }
        return;
    }
}

function clearHeaderContextSearch() {
    const input = document.getElementById('topbar-context-search');
    if (input) {
        input.value = '';
        input.innerHTML = '';
        if (typeof onHeaderContextSearch === 'function') {
            onHeaderContextSearch('');
        }
        input.focus();
    }
}

function updateHeaderSearchPlaceholder(tabId) {
    const input = document.getElementById('topbar-context-search');
    if (!input) return;
    const currentTab = tabId || localStorage.getItem('active_tab') || 'dashboard';

    if (currentTab === 'background-services') {
        const bgSub = localStorage.getItem('active_bg_subtab') || 'autodeploy';
        if (bgSub === 'tunnels') {
            input.placeholder = 'Tünel və ya layihə axtar...';
        } else if (bgSub === 'autodeploy') {
            input.placeholder = 'Auto-Deploy tətbiqi axtar...';
        } else if (bgSub === 'logs') {
            input.placeholder = 'Loqlarda axtar...';
        } else {
            input.placeholder = 'Sistem servisi axtar...';
        }
    } else if (currentTab === 'applications') {
        input.placeholder = 'Layihə adı / port axtar...';
    } else if (currentTab === 'servers') {
        input.placeholder = 'Server adı / IP axtar...';
    } else if (currentTab === 'keys-tokens') {
        input.placeholder = 'Açar / Token axtar...';
    } else {
        input.placeholder = 'Dashboard-da axtar...';
    }
}


