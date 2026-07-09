Write-Host "MasterDeploy Windows Qurasdirma Sistemine Xos Geldiniz!" -ForegroundColor Green

$InstallPath = "C:\MasterDeploy"
if (!(Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
}

Set-Location $InstallPath

if (!(Get-Command "git" -ErrorAction SilentlyContinue)) {
    Write-Host "Xeta: Git tapilmadi! Zəhmət olmasa Git quraşdırın." -ForegroundColor Red
    exit 1
}

if (Test-Path "$InstallPath\masterdeploy-rust\.git") {
    Write-Host "Layihe yenilenir..." -ForegroundColor Yellow
    Set-Location "$InstallPath\masterdeploy-rust"
    git fetch --all
    git reset --hard origin/main
} else {
    Write-Host "MasterDeploy yuklenir..." -ForegroundColor Yellow
    git clone https://github.com/kral14/server-repo-rust.git masterdeploy-rust
    Set-Location "$InstallPath\masterdeploy-rust"
}

Write-Host "Qurasdirma bitdi! python run_project.py emri ishe salir..." -ForegroundColor Green
python run_project.py
