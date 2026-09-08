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

