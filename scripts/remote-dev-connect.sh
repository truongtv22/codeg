#!/usr/bin/env bash
# remote-dev-connect.sh — kết nối & đồng bộ với VM dev macOS (workflow remote-dev.yml).
#
# Cách dùng (chạy từ repo root trên máy client):
#   scripts/remote-dev-connect.sh            # ssh + forward 8787 (mặc định)
#   scripts/remote-dev-connect.sh push       # rsync source lên VM (bước đầu của mọi vòng lặp)
#   scripts/remote-dev-connect.sh fe         # push + `pnpm build` trên VM (sửa frontend, ~1-2')
#   scripts/remote-dev-connect.sh build      # push + build devshell .app trên VM + pull (sửa Rust)
#   scripts/remote-dev-connect.sh pull       # tải .app debug từ VM về /tmp
#
# Cấu hình: export REMOTE_DEV_PORT=<port> (dòng SSH trong artifact 'remote-dev-connection',
# port bore đổi MỖI session). Override khi cần: REMOTE_DEV_HOST, REMOTE_DEV_USER,
# REMOTE_DEV_DIR.
set -euo pipefail

REMOTE_HOST="${REMOTE_DEV_HOST:-bore.pub}"
REMOTE_PORT="${REMOTE_DEV_PORT:?export REMOTE_DEV_PORT=<port> trước khi chạy (xem artifact remote-dev-connection)}"
REMOTE_USER="${REMOTE_DEV_USER:-runner}"
REMOTE_DIR="${REMOTE_DEV_DIR:-work/codeg/codeg}"
# Key: mặc định thử key đặt tên theo convention GitHub trước (id_ed25519_github),
# override bằng REMOTE_DEV_KEY. Tunnel qua relay công cộng hay bị NAT cắt ngầm khi
# nghỉ traffic — ServerAliveInterval giữ nó sống, ExitOnForwardFailure bắt chết sớm.
REMOTE_KEY="${REMOTE_DEV_KEY:-$([ -f "$HOME/.ssh/id_ed25519_github" ] && echo "$HOME/.ssh/id_ed25519_github")}"
# IdentitiesOnly: agent không được đưa key nào trước key đúng — bore.pub ngắt
# kết nối khi thử quá 6 key ("Too many authentication failures").
# accept-new: VM mới = port + host key mới mỗi session (TOFU — auth thật là SSH key).
SSH_OPTS=(-p "$REMOTE_PORT" ${REMOTE_KEY:+-i "$REMOTE_KEY"} \
  -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o ExitOnForwardFailure=yes \
  "${REMOTE_USER}@${REMOTE_HOST}")
# rsync/scp không nhận mảng SSH_OPTS — dựng chuỗi -e riêng, cùng key + IdentitiesOnly.
RSYNC_SSH="ssh -p ${REMOTE_PORT} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new ${REMOTE_KEY:+-i ${REMOTE_KEY}}"
# ssh non-interactive không thấy PATH của job steps: runner macos-latest cài node
# qua homebrew (/opt/homebrew/bin), pnpm qua action-setup (~/setup-pnpm/...).
# CI=true: pnpm không được hỏi xác nhận purge node_modules khi không có TTY.
REMOTE_ENV='export PATH="/opt/homebrew/bin:$HOME/setup-pnpm/node_modules/.bin:$PATH" CI=true'

# Verify workspace path trước khi rsync/scp mù quáng (tên dir phụ thuộc tên repo).
ssh "${SSH_OPTS[@]}" "test -d ~/${REMOTE_DIR}/.git || {
  echo \"FATAL: ~/${REMOTE_DIR} không phải repo — export REMOTE_DEV_DIR=<path>\" >&2; exit 2; }"

cmd="${1:-connect}"
case "$cmd" in
  connect)
    # Forward UI+API (8787); giữ shell mở để Ctrl+C chủ động ngắt.
    exec ssh "${SSH_OPTS[@]}" -L 8787:localhost:8787
    ;;
  push)
    rsync -az -e "$RSYNC_SSH" \
      --exclude node_modules --exclude .next --exclude out --exclude target \
      --exclude .git --exclude coverage \
      --exclude ".env" --exclude ".env.*" \
      ./ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
    echo "Đã push. Frontend → chạy 'fe'. Backend → chạy 'build'."
    ;;
  fe)
    "$0" push
    ssh "${SSH_OPTS[@]}" "cd ~/${REMOTE_DIR} && ${REMOTE_ENV} && pnpm build"
    echo "UI đã build lại — refresh browser/.app tại http://localhost:8787."
    ;;
  build)
    "$0" push
    ssh "${SSH_OPTS[@]}" "cd ~/${REMOTE_DIR} && ${REMOTE_ENV} && \
      pnpm tauri build --debug --target aarch64-apple-darwin \
        --config src-tauri/tauri.devshell.conf.json --bundles app"
    "$0" pull
    ;;
  pull)
    APP_DIR="src-tauri/target/aarch64-apple-darwin/debug/bundle/macos"
    ssh "${SSH_OPTS[@]}" "cd ~/${REMOTE_DIR}/${APP_DIR} && \
      ditto -c -k --keepParent codeg.app /tmp/codeg-devshell.zip"
    # scp 1 stream qua bore relay bị chặn bởi cửa sổ TCP × RTT (~0.2MB/s đo
    # thực — 87MB kéo ~9'). Chia chunk, tải 8 stream song song rồi gộp: tốc độ
    # gần như ×8. ponytail: nếu relay giới hạn theo kết nối thì gộp lại thành
    # 1 stream hoặc chuyển Tailscale P2P.
    CHUNKS=8
    SIZE=$(ssh "${SSH_OPTS[@]}" "stat -f%z /tmp/codeg-devshell.zip")
    CSIZE=$(( (SIZE + CHUNKS - 1) / CHUNKS ))
    ssh "${SSH_OPTS[@]}" "cd /tmp && split -b $CSIZE codeg-devshell.zip cds.zip.part-"
    PARTS=$(ssh "${SSH_OPTS[@]}" "ls -1 /tmp/cds.zip.part-*")
    for P in $PARTS; do
      scp ${REMOTE_KEY:+-i "$REMOTE_KEY"} -o IdentitiesOnly=yes \
        -o StrictHostKeyChecking=accept-new -P "$REMOTE_PORT" -q \
        "${REMOTE_USER}@${REMOTE_HOST}:$P" "/tmp/$(basename "$P")" &
    done
    wait
    cat /tmp/cds.zip.part-* > /tmp/codeg-devshell.zip
    ACTUAL=$(stat -f%z /tmp/codeg-devshell.zip)
    [ "$ACTUAL" = "$SIZE" ] || { echo "FATAL: pull hỏng ($ACTUAL ≠ $SIZE byte)" >&2; exit 1; }
    rm -f /tmp/cds.zip.part-*
    ssh "${SSH_OPTS[@]}" "rm -f /tmp/cds.zip.part-*"
    rm -rf /tmp/codeg-devshell.app
    # Zip bên VM đóng bằng --keepParent codeg.app → extract ra codeg.app, đổi
    # tên devshell để không đè Codeg.app thật của máy.
    ditto -x -k /tmp/codeg-devshell.zip /tmp/
    mv /tmp/codeg.app /tmp/codeg-devshell.app
    echo ".app ở /tmp/codeg-devshell.app — kéo vào ~/Applications để thay bản cũ."
    ;;
  *)
    echo "Lệnh không rõ: $cmd (connect|push|fe|build|pull)" >&2
    exit 1
    ;;
esac
