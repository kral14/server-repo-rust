// =====================================================
// keys_tokens.js — Keys & Tokens bölməsinin tam JS modulu
// Pəncərə yöneticisindən asılı olmayan öz overlay sistemi
// =====================================================

function ktShowOverlay(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = 'flex';
        el.classList.remove('minimized');
        if (typeof activeWindows !== 'undefined') {
            activeWindows[id] = true;
            delete minimizedWindows[id];
            if (typeof bringToFront === 'function') bringToFront(id);
            if (typeof updateTaskbar === 'function') updateTaskbar();
            if (typeof saveActiveWindowsState === 'function') saveActiveWindowsState();
        }
        const handler = (e) => {
            if (e.key === 'Escape') {
                ktHideOverlay(id);
                document.removeEventListener('keydown', handler);
            }
        };
        document.addEventListener('keydown', handler);
    }
}

function ktHideOverlay(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = 'none';
        el.classList.remove('minimized');
        if (typeof activeWindows !== 'undefined') {
            delete activeWindows[id];
            delete minimizedWindows[id];
            if (typeof updateTaskbar === 'function') updateTaskbar();
            if (typeof saveActiveWindowsState === 'function') saveActiveWindowsState();
        }
    }
}

function ktToggleAddMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('keys-add-dropdown-menu');
    if (!menu) return;
    const isShown = menu.style.display === 'block';
    menu.style.display = isShown ? 'none' : 'block';
}

function ktSelectAddOption(type) {
    const menu = document.getElementById('keys-add-dropdown-menu');
    if (menu) menu.style.display = 'none';

    if (type === 'ssh') {
        switchCoolifySubTab('ssh');
        ktOpenAddSshModal();
    } else if (type === 'rsa') {
        switchCoolifySubTab('ssh');
        generateRsaKeypair();
    } else if (type === 'api') {
        switchCoolifySubTab('api');
        const patCard = document.querySelector('#coolify-content-api .item-card');
        const details = patCard?.querySelector('.card-details');
        if (details) {
            details.style.display = 'flex';
            const input = document.getElementById('pane-gh-token');
            if (input) input.focus();
        }
    }
}

document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('keys-add-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        const menu = document.getElementById('keys-add-dropdown-menu');
        if (menu) menu.style.display = 'none';
    }
});

function switchCoolifySubTab(tab) {
    ['ssh', 'system-key', 'api', 'cloud'].forEach(t => {
        const btn = document.getElementById('subtab-btn-' + t);
        const content = document.getElementById('coolify-content-' + t);
        const badge = document.getElementById('subtab-badge-' + t);
        if (!btn || !content) return;
        const isActive = t === tab;
        btn.style.background = isActive ? 'var(--accent-color)' : 'transparent';
        btn.style.color = isActive ? '#000' : 'var(--text-secondary)';
        if (badge) {
            badge.style.background = isActive ? 'rgba(0,0,0,0.18)' : (t === 'system-key' ? 'rgba(46,204,113,0.12)' : 'rgba(255,255,255,0.08)');
            badge.style.color = isActive ? '#000' : (t === 'system-key' ? '#2ecc71' : 'var(--text-secondary)');
        }
        content.style.display = isActive ? 'flex' : 'none';
    });
}

function clearCoolifyKeysSearch() {
    const input = document.getElementById('coolify-search-keys');
    if (input) {
        input.value = '';
    }
    const clearBtn = document.getElementById('coolify-search-clear-btn');
    if (clearBtn) clearBtn.style.display = 'none';
    filterCoolifyKeys();
}

function filterCoolifyKeys() {
    const input = document.getElementById('coolify-search-keys');
    if (!input) return;

    // Əgər istifadəçi özü axtarış sahəsində deyilsə və brauzer 'admin' yaxud email doldurubsa, təmizlə
    if (document.activeElement !== input && (input.value.toLowerCase() === 'admin' || input.value.includes('@'))) {
        input.value = '';
    }

    const query = (input.value || '').trim().toLowerCase();
    const clearBtn = document.getElementById('coolify-search-clear-btn');
    if (clearBtn) {
        clearBtn.style.display = query ? 'block' : 'none';
    }

    const container = document.getElementById('keys-tokens-modular-root');
    if (!container) return;

    // Aktiv alt bölməni müəyyən edirik
    const activeSubtab = ['ssh', 'api', 'cloud'].find(t => {
        const el = document.getElementById('coolify-content-' + t);
        return el && el.style.display !== 'none';
    }) || 'ssh';

    const subContent = document.getElementById('coolify-content-' + activeSubtab);
    if (!subContent) return;

    let matchCount = 0;
    const cards = subContent.querySelectorAll('.item-card');
    cards.forEach(card => {
        const title = card.querySelector('h4')?.innerText?.toLowerCase() || '';
        const desc = card.querySelector('p')?.innerText?.toLowerCase() || '';
        const match = !query || title.includes(query) || desc.includes(query);
        card.style.display = match ? '' : 'none';
        if (match) matchCount++;
    });

    let emptyNotice = subContent.querySelector('.coolify-no-search-results');
    if (query && matchCount === 0 && cards.length > 0) {
        if (!emptyNotice) {
            emptyNotice = document.createElement('div');
            emptyNotice.className = 'coolify-no-search-results';
            emptyNotice.style.cssText = 'padding:2rem;text-align:center;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:10px;margin-top:0.5rem;';
            subContent.appendChild(emptyNotice);
        }
        emptyNotice.innerHTML = `
            <div style="font-size:1.4rem;margin-bottom:0.35rem;">🔍</div>
            <div style="font-size:0.86rem;font-weight:600;color:#f1f5f9;">"${escapeHtml(input.value)}" axtarışına uyğun heç bir açar tapılmadı</div>
            <p style="font-size:0.75rem;color:#64748b;margin:0.25rem 0 0.8rem 0;">Axtarış xanasındakı mətni silərək bütün mövcud açarları görə bilərsiniz.</p>
            <button onclick="clearCoolifyKeysSearch()" style="padding:0.4rem 0.9rem;font-size:0.78rem;font-weight:600;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;border-radius:6px;cursor:pointer;">
                ✕ Axtarışı Təmizlə
            </button>
        `;
        emptyNotice.style.display = 'block';
    } else {
        if (emptyNotice) emptyNotice.remove();
    }
}

function toggleCardDetail(header) {
    const card = header.closest('.item-card') || header.parentElement;
    const details = card.querySelector('.card-details');
    const chevron = card.querySelector('.chevron-icon');
    if (!details) return;
    const isOpen = details.style.display === 'flex';
    details.style.display = isOpen ? 'none' : 'flex';
    if (chevron) {
        chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
    }
}

async function loadSshKeys() {
    try {
        const res = await fetch('/api/ssh-keys');
        const keys = await res.json();
        const badge = document.getElementById('subtab-badge-ssh');
        if (badge) badge.textContent = keys.length;
        const container = document.getElementById('coolify-ssh-keys-container');
        if (!container) return;
        if (keys.length === 0) {
            container.innerHTML = '<div style="padding:1.5rem;text-align:center;color:#64748b;font-size:0.82rem;">Hələ heç bir SSH açarı əlavə edilməyib.</div>';
            return;
        }
        container.innerHTML = keys.map(k => {
            const fp = k.private_key && k.private_key.length > 20 ? k.private_key.substring(0,8) + '...' + k.private_key.slice(-8) : '-';
            const ek = (k.private_key||'').replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
            const dq = (k.private_key||'').replace(/"/g,'&quot;');
            
            const usedInfo = k.used_servers 
                ? `<span style="font-size:0.68rem;color:#38bdf8;background:rgba(56,189,248,0.1);padding:2px 6px;border-radius:4px;font-weight:600;margin-top:0.25rem;display:inline-block;">🔗 İstifadə olunur: ${k.used_servers}</span>` 
                : `<span style="font-size:0.68rem;color:#64748b;background:rgba(255,255,255,0.04);padding:2px 6px;border-radius:4px;font-weight:500;margin-top:0.25rem;display:inline-block;">Status: İstifadə olunmur</span>`;

            return `<div class="item-card kt-card-compact">
                <div onclick="toggleCardDetail(this)" style="padding:0.95rem 1.05rem;cursor:pointer;display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                     <div style="display:flex;align-items:flex-start;gap:0.75rem;min-width:0;flex:1;">
                        <div style="width:34px;height:34px;border-radius:8px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.25);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#818cf8;margin-top:2px;">
                            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M12 11.586l8-8"/><path d="M20 3l1 1-1 1"/><path d="M17 6l1 1"/></svg>
                        </div>
                        <div style="min-width:0;flex:1;">
                            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                                <h4 style="margin:0;font-weight:600;font-size:0.88rem;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;" title="${k.name}">${k.name}</h4>
                                <span style="font-size:0.62rem;padding:1px 6px;border-radius:4px;background:rgba(0,210,255,0.1);color:var(--accent-color);font-weight:600;">Qlobal</span>
                            </div>
                            <p style="margin:0.25rem 0 0.4rem 0;font-size:0.74rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${k.description||''}">${k.description||'Təsvir daxil edilməyib.'}</p>
                            ${usedInfo}
                        </div>
                    </div>
                    <div class="chevron-icon" style="transition:transform 0.2s;color:var(--text-secondary);margin-top:4px;"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>
                </div>
                <div class="card-details" style="display:none;flex-direction:column;gap:0.75rem;padding:0.9rem 1.05rem;border-top:1px solid rgba(255,255,255,0.05);background:rgba(0,0,0,0.2);">
                    <div>
                        <label style="display:block;font-size:0.65rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.35rem;">SSH Private Key</label>
                        <div style="position:relative;display:flex;align-items:center;">
                            <span class="kt-key-span" data-full="${dq}" style="flex:1;font-family:monospace;font-size:0.7rem;padding:0.45rem 2.6rem 0.45rem 0.6rem;border-radius:6px;border:1px solid rgba(255,255,255,0.05);background:rgba(0,0,0,0.3);color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                                ••••••••••••••••••••••••••••••••••••••••••••
                            </span>
                            <button onclick="event.stopPropagation();ktToggleKey(this)" data-masked="true" style="position:absolute;right:6px;background:transparent;border:none;color:var(--accent-color);cursor:pointer;font-size:0.7rem;font-weight:600;padding:0 3px;">Göstər</button>
                        </div>
                    </div>
                    <div style="font-family:monospace;font-size:0.66rem;color:#64748b;">Fingerprint: ${fp}</div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:0.3rem;gap:0.4rem;flex-wrap:wrap;">
                        <div style="display:flex;gap:0.35rem;">
                            <button onclick="event.stopPropagation();ktCopyRawKey(this)" style="padding:0.32rem 0.65rem;font-size:0.7rem;font-weight:600;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.05);color:#f1f5f9;cursor:pointer;display:flex;align-items:center;gap:0.25rem;">
                                <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                                Kopyala
                            </button>
                            <button onclick="event.stopPropagation();ktOpenEditSshModal('${k.id}', '${k.name.replace(/'/g, "\\'")}', '${(k.description||'').replace(/'/g, "\\'")}')" style="padding:0.32rem 0.65rem;font-size:0.7rem;font-weight:600;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.05);color:#f1f5f9;cursor:pointer;display:flex;align-items:center;gap:0.25rem;">
                                <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                Redaktə
                            </button>
                        </div>
                        <button onclick="event.stopPropagation();ktDeleteSshKey('${k.id}')" style="padding:0.32rem 0.65rem;font-size:0.7rem;font-weight:600;border-radius:6px;border:1px solid rgba(255,68,68,0.25);background:rgba(255,68,68,0.08);color:#ff6b6b;cursor:pointer;display:flex;align-items:center;gap:0.25rem;">
                            <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2-2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                            Sil
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');
        if (typeof loadSshKeysDropdown === 'function') {
            loadSshKeysDropdown('srv-key-id');
            loadSshKeysDropdown('edit-srv-key-id');
        }
    } catch(e) { console.error('SSH load error:', e); }
}

function ktToggleKey(btn) {
    const span = btn.previousElementSibling;
    if (!span) return;
    const masked = btn.dataset.masked === 'true';
    if (masked) {
        span.textContent = span.getAttribute('data-full') || '-';
        btn.textContent = 'Gizlət';
        btn.dataset.masked = 'false';
    } else {
        span.textContent = '••••••••••••••••••••••••••••••••••••••••••••';
        btn.textContent = 'Göstər';
        btn.dataset.masked = 'true';
    }
}

function ktCopyRawKey(btn) {
    const card = btn.closest('.item-card');
    const span = card?.querySelector('.kt-key-span');
    if (!span) return;
    const val = span.getAttribute('data-full');
    const name = card.querySelector('h4')?.innerText || 'SSH Key';
    ktCopyText(val, name);
}

function ktCopyText(text, label) {
    if (typeof copyTextToClipboard === 'function') {
        copyTextToClipboard(text, label);
    } else {
        navigator.clipboard.writeText(text).then(() => ktToast(label + ' kopyalandı!'));
    }
}

async function ktDeleteSshKey(id) {
    showConfirmCard({
        icon: '🔑',
        title: 'SSH Açarını Sil',
        subtitle: 'Bu SSH açarını silmək istədiyinizdən əminsiniz?',
        body: 'Diqqət: Açar silindikdən sonra geri qaytarıla bilməz.',
        confirmText: '🗑️ Sil',
        confirmStyle: 'background: #ff1744; color: white;',
        onConfirm: async () => {
            try {
                const res = await fetch('/api/ssh-keys/' + id, { method: 'DELETE' });
                if (res.ok) {
                    ktToast('SSH açarı silindi.', 'success');
                    loadSshKeys();
                } else {
                    const errText = await res.text();
                    showInfoCard('Açar Silinmədi!', 'Silinmə xətası baş verdi', errText || 'Bu açar hazırda aktiv server tərəfindən istifadə olunur.');
                }
            } catch(e) { 
                showInfoCard('Xəta!', 'Bağlantı xətası', 'Şəbəkə xətası baş verdi. Açar silinə bilmədi.'); 
            }
        }
    });
}

async function loadLocalSshKey() {
    try {
        const res = await fetch('/api/system/local-ssh-key');
        const data = await res.json();
        const input = document.getElementById('local-ssh-public-key-value');
        if (input) input.value = data.public_key || '';
        const mask = document.getElementById('coolify-local-key-mask');
        if (mask && data.public_key) {
            mask.setAttribute('data-full', data.public_key);
            // Public açar gizli deyil, ona görə birbaşa önbaxışını göstəririk:
            const preview = data.public_key.length > 55
                ? data.public_key.substring(0, 26) + '...' + data.public_key.slice(-24)
                : data.public_key;
            mask.textContent = preview;
        }
    } catch(_) {}
}

function ktOpenAddSshModal() {
    const n = document.getElementById('kt-key-name');
    const d = document.getElementById('kt-key-desc');
    const p = document.getElementById('kt-key-private');
    if (n) n.value = '';
    if (d) d.value = '';
    if (p) p.value = '';
    ktShowOverlay('kt-ssh-overlay');
    setTimeout(() => n?.focus(), 100);
}

async function ktHandleCreateSshKey(e) {
    e.preventDefault();
    const name = document.getElementById('kt-key-name').value.trim();
    const desc = document.getElementById('kt-key-desc').value.trim();
    const pk = document.getElementById('kt-key-private').value.trim();
    if (!name || !pk) { ktToast('Ad və Private Key mütləqdir.', 'error'); return; }
    try {
        const res = await fetch('/api/ssh-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: desc, private_key: pk })
        });
        if (res.ok) {
            ktToast('"' + name + '" açarı əlavə edildi!', 'success');
            ktHideOverlay('kt-ssh-overlay');
            loadSshKeys();
        } else {
            ktToast('Xəta: ' + await res.text(), 'error');
        }
    } catch(e) { ktToast('Şəbəkə xətası.', 'error'); }
}

async function loadGithubTokenStatus() {
    try {
        const res = await fetch('/api/settings/github-token');
        const data = await res.json();
        const badge = document.getElementById('coolify-github-token-status-badge');
        const statusEl = document.getElementById('pane-gh-status');
        const input = document.getElementById('pane-gh-token');
        if (data.token) {
            if (input) input.value = data.token;
            if (badge) {
                badge.textContent = 'Qoşulub';
                badge.style.background = 'rgba(46,204,113,0.12)';
                badge.style.color = '#2ecc71';
            }
            if (statusEl) {
                statusEl.textContent = 'Aktiv';
                statusEl.style.color = '#2ecc71';
            }
            const apiBadge = document.getElementById('subtab-badge-api');
            if (apiBadge) apiBadge.textContent = '1';
        } else {
            if (badge) {
                badge.textContent = 'Qoşulmayıb';
                badge.style.background = 'rgba(255,255,255,0.07)';
                badge.style.color = '#64748b';
            }
            if (statusEl) {
                statusEl.textContent = 'Token yoxdur';
                statusEl.style.color = '#64748b';
            }
        }
    } catch(_) {}
}

async function savePaneGithubToken() {
    const token = document.getElementById('pane-gh-token')?.value?.trim();
    if (!token) { ktToast('Token boş ola bilməz.', 'error'); return; }
    try {
        const res = await fetch('/api/settings/github-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        if (res.ok) {
            ktToast('GitHub token yadda saxlandı!', 'success');
            loadGithubTokenStatus();
        } else {
            ktToast('Saxlanma xətası.', 'error');
        }
    } catch(e) { ktToast('Şəbəkə xətası.', 'error'); }
}

function togglePaneGithubTokenVisibility(event) {
    event.stopPropagation();
    const input = document.getElementById('pane-gh-token');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

async function generateRsaKeypair() {
    const btns = document.querySelectorAll('#btn-generate-rsa');
    btns.forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.6';
        b.textContent = 'Yaradılır...';
    });
    try {
        const res = await fetch('/api/ssh-keys/generate-rsa', { method: 'POST' });
        if (!res.ok) { ktToast('RSA xəta: ' + await res.text(), 'error'); return; }
        const { private_key, public_key } = await res.json();
        const pubEl = document.getElementById('rsa-pub-display');
        const privEl = document.getElementById('rsa-priv-display');
        const nameEl = document.getElementById('rsa-key-name');
        if (pubEl) pubEl.value = public_key;
        if (privEl) privEl.value = private_key;
        if (nameEl) nameEl.value = '';
        ktShowOverlay('kt-rsa-overlay');
        setTimeout(() => nameEl?.focus(), 150);
    } catch(e) {
        ktToast('Şəbəkə xətası: ' + e.message, 'error');
    } finally {
        btns.forEach(b => {
            b.disabled = false;
            b.style.opacity = '1';
            b.innerHTML = '<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> RSA Açar Yarat';
        });
    }
}

async function saveRsaGeneratedKey() {
    const name = (document.getElementById('rsa-key-name')?.value || '').trim();
    const pk = document.getElementById('rsa-priv-display')?.value || '';
    if (!name) { ktToast('Açar adı daxil edin.', 'error'); document.getElementById('rsa-key-name')?.focus(); return; }
    if (!pk) { ktToast('Private key tapılmadı.', 'error'); return; }
    try {
        const res = await fetch('/api/ssh-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: 'RSA 4096-bit avtomatik yaradılmış açar', private_key: pk })
        });
        if (res.ok) {
            ktToast('"' + name + '" yadda saxlandı!', 'success');
            ktHideOverlay('kt-rsa-overlay');
            loadSshKeys();
        } else {
            ktToast('Saxlanma xətası: ' + await res.text(), 'error');
        }
    } catch(e) { ktToast('Şəbəkə xətası.', 'error'); }
}

function ktCopyField(id, label) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = el.value || el.textContent;
    ktCopyText(text, label);
}

function ktToast(msg, type) {
    if (typeof showToast === 'function') {
        showToast(msg, type || 'info');
        return;
    }
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;padding:0.7rem 1.1rem;border-radius:8px;font-size:0.83rem;font-weight:600;z-index:99999;color:#fff;background:' + (type==='error'?'#dc2626':type==='success'?'#16a34a':'#334155');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function ktOpenEditSshModal(id, name, desc) {
    const idEl = document.getElementById('kt-edit-key-id');
    const nameEl = document.getElementById('kt-edit-key-name');
    const descEl = document.getElementById('kt-edit-key-desc');
    if (idEl) idEl.value = id;
    if (nameEl) nameEl.value = name;
    if (descEl) descEl.value = desc;
    ktShowOverlay('kt-edit-ssh-overlay');
}

async function ktHandleUpdateSshKey(e) {
    e.preventDefault();
    const id = document.getElementById('kt-edit-key-id').value;
    const name = document.getElementById('kt-edit-key-name').value.trim();
    const desc = document.getElementById('kt-edit-key-desc').value.trim();
    if (!name) { ktToast('Ad mütləqdir.', 'error'); return; }
    try {
        const res = await fetch('/api/ssh-keys/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: desc })
        });
        if (res.ok) {
            ktToast('SSH açarı yeniləndi.', 'success');
            ktHideOverlay('kt-edit-ssh-overlay');
            loadSshKeys();
        } else {
            ktToast('Xəta: ' + await res.text(), 'error');
        }
    } catch(e) { ktToast('Şəbəkə xətası.', 'error'); }
}

async function initKeysTokens() {
    const searchInput = document.getElementById('coolify-search-keys');
    if (searchInput) {
        searchInput.value = '';
        searchInput.addEventListener('change', () => {
            if (document.activeElement !== searchInput && (searchInput.value.toLowerCase() === 'admin' || searchInput.value.includes('@'))) {
                searchInput.value = '';
                filterCoolifyKeys();
            }
        });
    }
    const clearBtn = document.getElementById('coolify-search-clear-btn');
    if (clearBtn) clearBtn.style.display = 'none';

    // Chrome/Edge autofill bəzən 100-500ms sonra doldurur, həmin anlarda təmizləyirik:
    [50, 150, 300, 600, 1000].forEach(delay => {
        setTimeout(() => {
            const input = document.getElementById('coolify-search-keys');
            if (input && document.activeElement !== input && (input.value.toLowerCase() === 'admin' || input.value.includes('@'))) {
                input.value = '';
                filterCoolifyKeys();
            }
        }, delay);
    });

    await loadSshKeys();
    await loadLocalSshKey();
    await loadGithubTokenStatus();
    switchCoolifySubTab('ssh');
}
