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

    const tunnelModeEl = document.getElementById('wiz-tunnel-mode');
    if (tunnelModeEl) {
        tunnelModeEl.value = 'none';
        toggleWizardTunnelMode();
    }

    loadWizServers();
    loadWizGithubRepos();
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

    // When going to step 4, ensure servers and GitHub repos are loaded
    if (step === 4) {
        loadWizServers();
        loadWizGithubRepos();
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
        if (serverSelect) {
            serverSelect.innerHTML = optionsHtml;
            updateServerStatsAdvisor('wiz-app-server', 'wiz-server-advisor', 'wiz-app-memory', 'wiz-app-cpu');
            loadWizServerTunnels(serverSelect.value);
            serverSelect.onchange = () => {
                updateServerStatsAdvisor('wiz-app-server', 'wiz-server-advisor', 'wiz-app-memory', 'wiz-app-cpu');
                loadWizServerTunnels(serverSelect.value);
            };
        }
        if (appServerSelect) appServerSelect.innerHTML = optionsHtml;
    } catch (e) {
        console.error("loadWizServers error:", e);
    }
}

function toggleWizardTunnelMode() {
    const mode = document.getElementById('wiz-tunnel-mode')?.value || 'none';
    const existingGroup = document.getElementById('wiz-existing-tunnel-group');
    const newGroup = document.getElementById('wiz-new-tunnel-group');
    if (existingGroup) existingGroup.style.display = mode === 'shared' ? 'block' : 'none';
    if (newGroup) newGroup.style.display = mode === 'dedicated' ? 'block' : 'none';
    
    if (mode === 'shared') {
        const serverId = document.getElementById('wiz-app-server')?.value;
        if (serverId) {
            loadWizServerTunnels(serverId);
        }
    }
}
window.toggleWizardTunnelMode = toggleWizardTunnelMode;

async function loadWizServerTunnels(serverId) {
    const tunnelSelect = document.getElementById('wiz-selected-tunnel');
    if (!tunnelSelect) return;
    if (!serverId) {
        tunnelSelect.innerHTML = '<option value="">Əvvəlcə server seçin</option>';
        return;
    }
    try {
        const res = await fetch(`/api/tunnels/server/${serverId}`);
        if (res.ok) {
            const tunnels = await res.json();
            if (!tunnels || tunnels.length === 0) {
                tunnelSelect.innerHTML = '<option value="">Bu serverdə tünel tapılmadı (Yeni yaradın)</option>';
            } else {
                tunnelSelect.innerHTML = tunnels.map(t => {
                    const routeCount = t.routes ? t.routes.length : 0;
                    const typeLabel = t.tunnel_type === 'shared' ? 'Ortaq' : 'Dedicated';
                    return `<option value="${t.id}">${t.name} (${typeLabel} - ${routeCount} marşrut)</option>`;
                }).join('');
            }
        } else {
            tunnelSelect.innerHTML = '<option value="">Tünellər yüklənə bilmədi</option>';
        }
    } catch (e) {
        console.error("loadWizServerTunnels error:", e);
        tunnelSelect.innerHTML = '<option value="">Xəta baş verdi</option>';
    }
}
window.loadWizServerTunnels = loadWizServerTunnels;

let wizGithubReposCache = [];

async function loadWizGithubRepos(forceRefresh = false) {
    const repoSelect = document.getElementById('wiz-repo-select');
    if (!repoSelect) return;

    if (!forceRefresh && wizGithubReposCache && wizGithubReposCache.length > 0) {
        populateWizRepoDropdown(wizGithubReposCache);
        return;
    }

    repoSelect.innerHTML = '<option value="">🐱 GitHub Repozitoriyaları yüklənir...</option>';

    try {
        let token = typeof githubToken !== 'undefined' ? githubToken : '';
        if (!token) {
            const tokenRes = await fetch('/api/settings/github-token');
            if (tokenRes.ok) {
                const tokenData = await tokenRes.json();
                token = tokenData.token || '';
                if (typeof githubToken !== 'undefined') githubToken = token;
            }
        }

        if (!token) {
            repoSelect.innerHTML = '<option value="">⚠️ GitHub Token tapılmadı (Açarlar və Tokenlər bölməsindən əlavə edin)</option>';
            return;
        }

        const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
            headers: { 'Authorization': `token ${token}` }
        });

        if (res.ok) {
            wizGithubReposCache = await res.json();
            populateWizRepoDropdown(wizGithubReposCache);
        } else {
            repoSelect.innerHTML = '<option value="">❌ Repozitoriyaları almaq olmadı (Token icazələrini yoxlayın)</option>';
        }
    } catch (e) {
        repoSelect.innerHTML = `<option value="">❌ Bağlantı xətası: ${e.message}</option>`;
    }
}

function populateWizRepoDropdown(repos) {
    const repoSelect = document.getElementById('wiz-repo-select');
    if (!repoSelect) return;

    if (!Array.isArray(repos) || repos.length === 0) {
        repoSelect.innerHTML = '<option value="">Heç bir repozitoriya tapılmadı</option>';
        return;
    }

    const currentUrl = document.getElementById('wiz-app-repo')?.value || '';

    repoSelect.innerHTML = `<option value="">-- GitHub Repozitoriyasını Seçin (${repos.length} Repo) --</option>` +
        repos.map(r => {
            const cloneUrl = r.clone_url || `https://github.com/${r.full_name}.git`;
            const isSelected = currentUrl && (currentUrl === cloneUrl || currentUrl.includes(r.full_name));
            const icon = r.private ? '🔒' : '🌐';
            return `<option value="${cloneUrl}" data-name="${r.name}" data-branch="${r.default_branch || 'main'}" ${isSelected ? 'selected' : ''}>${icon} ${r.full_name}</option>`;
        }).join('');
}

function handleWizRepoSelectChange(selectEl) {
    const url = selectEl.value;
    if (!url) return;

    const opt = selectEl.options[selectEl.selectedIndex];
    const repoName = opt.getAttribute('data-name') || '';
    const defaultBranch = opt.getAttribute('data-branch') || 'main';

    const repoUrlInput = document.getElementById('wiz-app-repo');
    if (repoUrlInput) repoUrlInput.value = url;

    const branchInput = document.getElementById('wiz-app-branch');
    if (branchInput) branchInput.value = defaultBranch;

    const nameInput = document.getElementById('wiz-app-name');
    if (nameInput && (!nameInput.value || nameInput.value === 'my-docker-service' || nameInput.value === 'my-web-app')) {
        nameInput.value = repoName;
    }
}

window.loadWizGithubRepos = loadWizGithubRepos;
window.handleWizRepoSelectChange = handleWizRepoSelectChange;

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
        let branch = branchVal || "";

        if (deployType === 'git') {
            const repoSelect = document.getElementById('wiz-repo-select');
            if (repoUrlVal) {
                repoUrl = repoUrlVal;
            } else if (repoSelect && repoSelect.value) {
                repoUrl = repoSelect.value;
                if (!branch && repoSelect.selectedOptions?.[0]?.getAttribute('data-branch')) {
                    branch = repoSelect.selectedOptions[0].getAttribute('data-branch');
                }
            } else if (typeof wizSelectedRepo !== 'undefined' && wizSelectedRepo && wizSelectedRepo.manualUrl) {
                repoUrl = wizSelectedRepo.manualUrl;
            } else if (typeof wizSelectedRepo !== 'undefined' && wizSelectedRepo && wizSelectedRepo.full_name && !wizSelectedRepo.isDocker) {
                const token = typeof githubToken !== 'undefined' ? githubToken : '';
                if (wizSelectedRepo.private && token) {
                    repoUrl = `https://${token}@github.com/${wizSelectedRepo.full_name}.git`;
                } else {
                    repoUrl = `https://github.com/${wizSelectedRepo.full_name}.git`;
                }
            }

            if (!branch) {
                branch = "main";
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

            // Tunnel integration (Shared or Dedicated)
            const tunnelMode = document.getElementById('wiz-tunnel-mode')?.value || 'none';
            if (tunnelMode === 'shared') {
                const selectedTunnelId = document.getElementById('wiz-selected-tunnel')?.value;
                if (selectedTunnelId) {
                    try {
                        await fetch(`/api/tunnels/${selectedTunnelId}/attach`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                app_id: app.id,
                                target_port: payload.port,
                                route_path: '/'
                            })
                        });
                        // Trigger remote VM sync in background
                        fetch(`/api/tunnels/${selectedTunnelId}/sync-remote`, { method: 'POST' }).catch(() => {});
                        addActivityLog(`Tətbiq ortaq tünelə bağlandı: '${app.name}'`, 'tunnel');
                    } catch (tErr) {
                        console.error("Tünel bağlama xətası:", tErr);
                    }
                }
            } else if (tunnelMode === 'dedicated') {
                let tName = document.getElementById('wiz-new-tunnel-name')?.value?.trim();
                if (!tName) tName = `${app.name}-tunnel`;
                try {
                    const createTunRes = await fetch(`/api/tunnels/server/${serverId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: tName,
                            tunnel_type: 'dedicated'
                        })
                    });
                    if (createTunRes.ok) {
                        const newTun = await createTunRes.json();
                        await fetch(`/api/tunnels/${newTun.id}/attach`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                app_id: app.id,
                                target_port: payload.port,
                                route_path: '/'
                            })
                        });
                        // Trigger remote VM sync in background
                        fetch(`/api/tunnels/${newTun.id}/sync-remote`, { method: 'POST' }).catch(() => {});
                        addActivityLog(`Yeni dedicated tünel yaradıldı və qoşuldu: '${tName}'`, 'tunnel');
                    }
                } catch (tErr) {
                    console.error("Dedicated tünel yaratma xətası:", tErr);
                }
            }

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
