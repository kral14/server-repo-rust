#!/bin/bash
set -e

# Make sure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Zəhmət olmasa, skripti 'root' kimi və ya 'sudo' ilə icra edin (sudo bash install.sh)"
  exit 1
fi

# Check for whiptail, install if missing
if ! command -v whiptail &> /dev/null; then
    echo "Whiptail quraşdırılır (TUI üçün)..."
    apt-get update && apt-get install -y whiptail
fi

whiptail --title "MasterDeploy Installer" --msgbox "MasterDeploy Quraşdırma Sisteminə Xoş Gəldiniz!\n\nBu proqram serverinizi avtomatik tənzimləyəcək və paneli quracaq." 10 60

# 1. Path
INSTALL_PATH=$(whiptail --title "Quraşdırma Qovluğu" --inputbox "MasterDeploy kodları hansı qovluğa endirilsin?" 10 60 "/opt/masterdeploy" 3>&1 1>&2 2>&3)
if [ -z "$INSTALL_PATH" ]; then
    echo "Quraşdırma ləğv edildi."
    exit 1
fi

# 2. Swap Option
if whiptail --title "Virtual RAM (Swap)" --yesno "Serverinizdə donmaların qarşısını almaq üçün Swap (Virtual RAM) əlavə edilsinmi?" 10 60; then
    SWAP_SIZE=$(whiptail --title "Swap Həcmi" --inputbox "Neçə GB Swap əlavə edilsin? (Sadecə rəqəm yazın, məs: 2)" 10 60 "2" 3>&1 1>&2 2>&3)
    if [ ! -z "$SWAP_SIZE" ]; then
        echo "======================================"
        echo "[SETUP] $SWAP_SIZE GB Swap yaradılır..."
        echo "======================================"
        if [ ! -f /swapfile ]; then
            fallocate -l ${SWAP_SIZE}G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$(($SWAP_SIZE * 1024))
            chmod 600 /swapfile
            mkswap /swapfile
            swapon /swapfile
            echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
            
            # Swappiness
            sysctl vm.swappiness=10
            grep -q "vm.swappiness=10" /etc/sysctl.conf || echo 'vm.swappiness=10' | tee -a /etc/sysctl.conf
            
            whiptail --title "Uğurlu" --msgbox "Swap uğurla yaradıldı və konfiqurasiya edildi!" 8 45
        else
            whiptail --title "Məlumat" --msgbox "Serverinizdə artıq /swapfile mövcuddur. Bu addım atlanılır." 8 50
        fi
    fi
fi

# 3. Docker Option
if ! command -v docker &> /dev/null; then
    if whiptail --title "Docker Quraşdırılması" --yesno "Sistemdə Docker tapılmadı. Avtomatik yüklənib qurulsunmu?" 10 60; then
        echo "======================================"
        echo "[SETUP] Docker yüklənir..."
        echo "======================================"
        curl -fsSL https://get.docker.com -o get-docker.sh
        sh get-docker.sh
        systemctl enable docker
        systemctl start docker
        whiptail --title "Uğurlu" --msgbox "Docker uğurla quruldu!" 8 40
    else
        whiptail --title "Xəbərdarlıq" --msgbox "Diqqət: MasterDeploy Docker olmadan işləyə bilməz. Quraşdırma dayanır." 10 60
        exit 1
    fi
fi

# 4. Git Option
if ! command -v git &> /dev/null; then
    apt-get update && apt-get install -y git
fi

# 5. Clone and build
echo "======================================"
echo "[SETUP] MasterDeploy yüklənir..."
echo "======================================"

if [ -d "$INSTALL_PATH/.git" ]; then
    cd "$INSTALL_PATH"
    git fetch --all
    git reset --hard origin/main
else
    git clone https://github.com/kral14/server-repo-rust.git "$INSTALL_PATH"
fi

cd "$INSTALL_PATH/masterdeploy-rust"

echo "======================================"
echo "[SETUP] Ən son MasterDeploy imici GHCR-dən çəkilir..."
echo "======================================"
docker pull ghcr.io/kral14/server-repo-rust:latest

echo "======================================"
echo "[SETUP] Köhnə konteyner silinir (əgər varsa)..."
echo "======================================"
docker stop masterdeploy 2>/dev/null || true
docker rm masterdeploy 2>/dev/null || true

echo "======================================"
echo "[SETUP] MasterDeploy işə salınır..."
echo "======================================"
# CRITICAL: DO NOT CHANGE THIS VOLUME MAPPING. IT MUST REMAIN /data/masterdeploy:/app/data TO PREVENT DATA LOSS DURING UPGRADES.
docker run -d --name masterdeploy --restart always -p 3000:3000 \
  -v /data/masterdeploy:/app/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/kral14/server-repo-rust:latest

IP_ADDR=$(curl -s ifconfig.me || echo "SERVER_IP")
whiptail --title "Təbrik edirik! 🎉" --msgbox "MasterDeploy uğurla quruldu və işə salındı!\n\nBrauzerdə daxil olun:\nhttp://$IP_ADDR:3000" 12 60

echo "Quraşdırma bitdi! Sistem tam hazırdır."
