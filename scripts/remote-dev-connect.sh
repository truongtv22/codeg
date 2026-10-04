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
SSH_OPTS=(-p "$REMOTE_PORT" "${REMOTE_USER}@${REMOTE_HOST}")

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
    rsync -az -e "ssh -p ${REMOTE_PORT}" \
      --exclude node_modules --exclude .next --exclude out --exclude target \
      --exclude .git --exclude coverage \
      --exclude ".env" --exclude ".env.*" \
      ./ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
    echo "Đã push. Frontend → chạy 'fe'. Backend → chạy 'build'."
    ;;
  fe)
    "$0" push
    ssh "${SSH_OPTS[@]}" "cd ~/${REMOTE_DIR} && pnpm build"
    echo "UI đã build lại — refresh browser/.app tại http://localhost:8787."
    ;;
  build)
    "$0" push
    ssh "${SSH_OPTS[@]}" "cd ~/${REMOTE_DIR} && \
      pnpm tauri build --debug --target aarch64-apple-darwin \
        --config src-tauri/tauri.devshell.conf.json --bundles app"
    "$0" pull
    ;;
  pull)
    APP_DIR="src-tauri/target/aarch64-apple-darwin/debug/bundle/macos"
    ssh "${SSH_OPTS[@]}" "cd ~/${REMOTE_DIR}/${APP_DIR} && \
      ditto -c -k --keepParent codeg.app /tmp/codeg-devshell.zip"
    scp -P "$REMOTE_PORT" \
      "${REMOTE_USER}@${REMOTE_HOST}:/tmp/codeg-devshell.zip" /tmp/codeg-devshell.zip
    rm -rf /tmp/codeg-devshell.app
    ditto -x -k /tmp/codeg-devshell.zip /tmp/
    echo ".app ở /tmp/codeg-devshell.app — kéo vào /Applications để thay bản cũ."
    ;;
  *)
    echo "Lệnh không rõ: $cmd (connect|push|fe|build|pull)" >&2
    exit 1
    ;;
esac
