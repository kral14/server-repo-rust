#!/bin/bash
mkdir -p /tmp/masterdeploy
cd /tmp/masterdeploy
curl -sLO https://raw.githubusercontent.com/kral14/server-repo-rust/main/remote_installer.py
curl -sLO https://raw.githubusercontent.com/kral14/server-repo-rust/main/installer_gui.py
python3 remote_installer.py
