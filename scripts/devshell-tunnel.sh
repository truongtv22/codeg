#!/usr/bin/env bash
# devshell-tunnel.sh — giữ tunnel 8787 tới codeg-server trên VM remote-dev.
#
# LaunchAgent (com.codeg.devshell-tunnel) chạy nền script này: VM mới mỗi
# session đều cùng hostname Tailscale (codeg-vm) nên không cần sửa gì khi
# VM đổi IP/port. VM chưa lên thì thử lại mỗi 20s.
set -u
LOG="$HOME/.cache/codeg-devshell-tunnel.log"
mkdir -p "$(dirname "$LOG")"
while true; do
  TS_IP="$(/usr/local/bin/tailscale ip -4 codeg-vm 2>/dev/null)"
  if [ -n "$TS_IP" ]; then
    ssh -N -L 8787:localhost:8787 \
      -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -o ConnectTimeout=10 \
      -i "$HOME/.ssh/id_ed25519_github" "runner@$TS_IP" >>"$LOG" 2>&1
    echo "$(date '+%F %T') tunnel exited ($?)" >>"$LOG"
  fi
  sleep 20
done
