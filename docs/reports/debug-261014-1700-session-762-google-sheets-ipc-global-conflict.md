# Debug Report: Session 762 — Google Sheets không load trong browser nhúng ("Sự cố khi tải")

- **Ngày phân tích:** 2026-10-14 → 2026-10-15
- **Session bị lỗi:** codeg session 762 — project xplori-monorepo, sheet `1lREIcK6PJkCmoYTPWcbY8f3iMBCSmzb8xD-6x-qac3g`
- **Nguồn bằng chứng:**
  - Transcript: `~/.claude/projects/-Volumes-Media-Xplori-xplori-monorepo/ec62694e-44cb-4839-906a-edefdb007ac7.jsonl` (37 dòng)
  - Console 6 lỗi capture từ built-in browser (codeg page-channel `console.rs`)
  - Source wry: `~/.cargo/registry/src/.../wry-0.55.1/src/wkwebview/mod.rs:637-642`
  - Source codeg: `src-tauri/src/browser/surface_child.rs:1-3`
- **Trạng thái:** Đã xác định nguyên nhân gốc + **ĐÃ VÁ** (commit `adf2b815`, vendor wry + `configurable: true`, version 0.35.2)

---

## 1. Hiện tượng

Mở Google Sheet trong tab browser nhúng của codeg → trang báo lỗi của Google:

```
Sự cố khi tải
Khắc phục sự cố này bằng cách xóa các tài nguyên của ứng dụng
Làm theo những hướng dẫn này để xóa bộ nhớ đệm và cookie của trình duyệt
Sau đó, tải lại trang này
```

Console 6 lỗi (lỗi đầu là gốc, 5 lỗi sau là hệ quả):

```
TypeError: Can't declare global function 'ipc': property must be either
  configurable or both writable and enumerable          <- GỐC
ReferenceError: Can't find variable: RITZ_initializeModules
TypeError: undefined is not an object (evaluating 'trixApp.getInitialLoadTiming')
ReferenceError: Can't find variable: cu
ReferenceError: Can't find variable: waffle_api
(rejection) Error: DOCS_initialLoadTiming is not defined.
```

Server-side không vấn đề gì: `curl -sI` trả **HTTP 200** với đầy đủ HTML ~284KB.

## 2. Chuỗi nguyên nhân gốc

1. Tab browser nhúng trên macOS là **wry child webview** build trực tiếp qua
   `tauri-runtime-wry` re-export (`surface_child.rs:1-3`).
2. wry 0.55.1 inject **cứng** vào mọi WKWebView, không có option tắt
   (`wkwebview/mod.rs:637-642`):
   ```js
   Object.defineProperty(window, 'ipc', {
     value: Object.freeze({postMessage: function(s) {window.webkit.messageHandlers.ipc.postMessage(s);}})
   });   // không truyền flag -> non-writable, non-enumerable, NON-CONFIGURABLE
   ```
3. Script boot inline của Google Sheets khai báo global `function ipc` (framework
   waffle/trix dùng cho messaging liên frame). JavaScriptCore từ chối khai báo
   hàm toàn cục đè lên property non-configurable → throw TypeError ở trên.
4. Script chết giữa chừng → `RITZ_initializeModules`, `waffle_api`, `trixApp`,
   `DOCS_initialLoadTiming` chưa kịp khai báo → 5 lỗi còn lại.
5. Frontend Google thấy init fail → hiện trang generic "xóa cache & cookie" —
   **khuyến cáo gây hiểu lầm**, không phải cache/cookie.

Codeg không inject `ipc` nào (grep toàn bộ `src-tauri` rỗng); UI chính của codeg
không khai báo global `ipc` nên không bị. Chỉ trang nào tự khai báo `function ipc`
(Google editor) mới dính.

**Phạm vi:** script y hệt có ở `webview2/mod.rs:885` (Windows) và
`webkitgtk/mod.rs:344` (Linux) — Google Sheets sẽ hỏng tương tự trên cả 3 platform.

**Upstream:** branch `dev` của wry (check 2026-10-15) vẫn inject frozen — chưa fix.

## 3. Vá (commit `adf2b815`)

Không thể fix từ phía codeg: script của wry chạy trước mọi init script khác, và
property non-configurable thì không thể xóa/định nghĩa lại từ script sau → phải
patch wry.

- **Vendor** wry 0.55.1 vào `src-tauri/vendor/wry` (868KB), `cargo check` cả 3 cấu
  hình binary (desktop / server-bin / mcp-bin) đều pass.
- **Thay đổi duy nhất:** thêm `configurable: true` vào cả 3 chỗ inject
  (`wkwebview/mod.rs`, `webview2/mod.rs`, `webkitgtk/mod.rs`).
- Wire qua `[patch.crates-io]` trong `src-tauri/Cargo.toml` (Cargo.lock tự drop
  `source`/`checksum` của wry registry).
- An toàn cho app: `configurable: true` chỉ có tác dụng khi trang **tự khai báo**
  `function ipc` — trang đó khi đó shadow bridge của wry (trang remote không dùng
  wry IPC nên vô hại); UI chính của codeg không khai báo `ipc` nên bridge giữ
  nguyên.

**Kiểm chứng semantics** (node/V8, JSC cùng luật DefineOwnProperty cho global
function declaration):

```
FROZEN (wry hiện tại): throws
PATCHED (configurable: true): declared OK
```

Trường hợp thật cần xác nhận trên app build 0.35.2: mở lại sheet trong browser
nhúng, console phải sạch 6 lỗi trên.

## 4. Unresolved questions

- Chưa xác nhận GUI thực tế trên bản 0.35.2 (chờ release build mac arm xong).
- Khi wry upstream fix (làm `ipc` configurable), nên re-vendor theo version đó và
  xóa fork — đã ghi chú trong `[patch.crates-io]` của `Cargo.toml`.
