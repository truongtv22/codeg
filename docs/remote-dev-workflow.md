# Remote dev VM (macOS) — dev không cần Rust toolchain trên máy local

Workflow: [`.github/workflows/remote-dev.yml`](../.github/workflows/remote-dev.yml)
Thay thế: `debug-tmate.yml` (đã xóa — job ubuntu + tmate relay chết).

## Nguyên lý

GitHub cấp **1 VM macOS 6h** mỗi lần dispatch. VM giữ toàn bộ phần nặng (rust-cache,
node_modules, `target/`). Máy local chỉ giữ source (~230M) + một devshell `.app`
(~300M) — không Rust, không node_modules, không `target/`.

```
VM macOS (6h)                          Mac local
─────────────────                      ─────────────────────
checkout + rust-cache ấm               source code
pnpm install + pnpm build → out/       scripts/remote-dev-connect.sh
devshell .app (debug, ad-hoc)          ssh -L 8787 tunnel
codeg-server :8787 (UI out/ + API+WS) ◄── browser / .app
sshd + bore.pub tunnel                 ~0.6G tổng dung lượng
Telegram notify + respawn gate
```

**Một origin duy nhất (:8787)**: transport web bắt `baseUrl = window.location.origin`
(`src/lib/transport/index.ts`) nên UI phải cùng origin với API. `next dev :3000` bị
loại vì rewrites không proxy được `/ws/events`. Devshell `.app` nạp UI từ
`http://localhost:8787` qua `build.frontendDist` URL (Tauri 2 hỗ trợ URL — không nhúng
asset; origin khớp ⇒ `is_local_url()` ⇒ IPC invoke() chạy với capabilities hiện có).

## Vòng lặp hằng ngày

```bash
gh workflow run remote-dev.yml --repo truongtv22/codeg --ref main
# ~5-15 phút: VM boot + cache + build → Telegram gửi "remote dev VM ready"
# Tải artifact 'remote-dev-connection' → lấy port bore (đổi MỖI session)

export REMOTE_DEV_PORT=<port>

scripts/remote-dev-connect.sh           # ssh + forward 8787 (giữ terminal mở)
# UI: http://localhost:8787 — token = giá trị CODEG_TOKEN

scripts/remote-dev-connect.sh push      # rsync source lên VM (bước đầu mọi vòng lặp)
scripts/remote-dev-connect.sh fe        # sửa frontend: push + pnpm build (~1-2') + refresh
scripts/remote-dev-connect.sh build     # sửa backend: push + build devshell .app + pull
#   → .app rơi vào /tmp/codeg-devshell.app — kéo vào /Applications (không dính quarantine)
```

## Hết 6h

Telegram hỏi "Tạo run mới?" (cửa sổ 20 phút). Duyệt → keeper/`gh workflow run` tạo
session mới với cache ấm. Không duyệt → chuỗi dừng. `GATE_DECISION` in ra log run.

## Bảo mật

- Chỉ SSH key đăng ký trên tài khoản GitHub kích hoạt được kết nối (authorized_keys
  từ `api.github.com/users/<actor>/keys`). Port bore public nhưng xoay mỗi session.
- `CODEG_TOKEN` mặc định là throwaway; set secret để pin. VM không giữ secret nào khác.
- Devshell `.app` chỉ dùng máy dev cá nhân — KHÔNG phát hành (IPC trust với mọi process
  phục vụ origin đó; bản release đi đường `release.yml` có signing key riêng).

## Giới hạn đã biết

- Trần cứng 6h/job (GitHub) — gate hồi sinh xử lý; sửa code giữa chừng khi VM chết:
  session mới tự cache ấm, `push` lại là tiếp tục.
- Sửa frontend chậm hơn HMR thật (~1-2 phút `pnpm build`): do transport hardcode
  origin. Muốn HMR: viết proxy `/api` + `/ws` trên :3000 (để sau — YAGNI).
- sshd trên runner macOS chưa được GitHub document — nếu fail, job chết sớm ở bước
  tunnel (fail fast ~2-3 phút); xem log run.
- `rsync` không `--delete`: file xóa local còn tồn tại trên VM — chấp nhận cho VM
  ngắn hạn.
