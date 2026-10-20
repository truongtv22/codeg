# Debug Report: Session 762 — Google Sheets render mờ trong browser nhúng

- **Ngày phân tích:** 2026-10-15
- **Session bị lỗi:** codeg session 762 — project xplori-monorepo, sheet `1lREIcK6PJkCmoYTPWcbY8f3iMBCSmzb8xD-6x-qac3g`
- **Tiền đề:** bản 0.35.2 đã vá lỗi "Sự cố khi tải" (wry `window.ipc` non-configurable — xem
  `debug-261014-1700-session-762-google-sheets-ipc-global-conflict.md`). Sheet load được,
  nhưng nội dung bảng mờ.
- **Trạng thái:** Đã xác định nguyên nhân gốc + **ĐÃ VÁ** (shim `outerWidth`/`outerHeight`,
  version 0.35.3)

---

## 1. Hiện tượng

Google Sheet load bình thường sau 0.35.2, nhưng chữ và đường kẻ trong **lưới bảng** mờ
(toolbar, menu thì nét). Chỉ lưới — phần vẽ bằng canvas — bị.

## 2. Chuỗi nguyên nhân gốc

1. Tab browser nhúng trên macOS là **wry child webview** — một WKWebView được gắn
   làm subview của cửa sổ khác, **không có window rect riêng**. WebKit trả
   `window.outerWidth` / `outerHeight` = **0** cho nó. Browser thật không bao giờ
   trả 0.
2. Renderer lưới của Google Sheets (waffle, hàm `NQc` trong bundle
   `spreadsheets.waffle_js_prod_integrated`) bù mức zoom của trình duyệt qua tỉ số:

   ```js
   var c = a.ma.getWindow().devicePixelRatio || 1;
   e = e.outerWidth / e.innerWidth;   // 0 / 844 = 0 trong webview của codeg
   e = PQc[cb(PQc, e)] || ...;        // snap về bước nhỏ nhất trong bảng zoom Chrome
                                      // → 0.25
   ```

3. Hệ quả: canvas backing store của lưới bị vẽ ở **1/4 kích thước** rồi phóng lên 4×.
   Đo trực tiếp trong tab thật (dpr = 1, màn 1920×1080 @1×):

   | Đại lượng            | Trước   | Sau fix  |
   |----------------------|---------|----------|
   | `outerWidth`         | 0       | 844      |
   | canvas attr          | 208×188 | 832×751  |
   | canvas CSS           | 832×751 | 832×751  |
   | attr / CSS           | 0.25    | **1.0**  |

   dpr = 1 nên toàn bộ hệ số 0.25 đến từ tỉ số `outerWidth/innerWidth`.

**Phạm vi:** chỉ macOS (WKWebView child view). WebView2 (Windows) và WebKitGTK
(Linux, owned window) trả kích thước window thật. Chỉ trang nào tự bù zoom qua
`outerWidth` mới dính — Google Docs/Sheets là case phổ biến nhất.

## 3. Vá (0.35.3)

Không thể vá từ phía Google. Fix phía codeg: inject shim vào **page world,
document start, mọi frame** cho tab nhúng — cùng đường với `console.js`:

- `src/browser-injected/outer-size.js` — script mới: khi `window.outerWidth === 0`,
  định nghĩa lại `outerWidth`/`outerHeight` thành getter trả `innerWidth`/`innerHeight`
  (lazy, tự theo resize; `configurable: true` để trang tự định nghĩa lại được nếu cần).
- `src-tauri/src/browser/channel.rs` — const `OUTER_SIZE_JS` (cfg macOS).
- `src-tauri/src/browser/surface_child.rs` — thêm vào mảng page scripts của
  `shim::install_world` (`install_channel_inner`, nhánh macOS).

Guard `outerWidth !== 0 → return` giữ shim thành no-op trên mọi platform/window
khác và tôn trọng trang nào đã tự định nghĩa property trước document start.

**Kiểm chứng in vivo trước khi vá:** inject tay 2 getter bằng browser_eval vào tab
đang mờ, đổi zoom của sheet (50% ↔ 100%) để tạo lại renderer → canvas attr chuyển
208×188 → 832×751 (ratio 1.0), lưới nét ngay tại chỗ.

## 4. Unresolved questions

- Bản build 0.35.3 cần mở lại sheet (hoặc reload tab) để xác nhận shim vào đúng lúc
  document start — lần này innerWidth không được dùng làm guard nên không phụ thuộc
  layout sớm.
- Nếu Google thay cơ chế bù zoom (đọc `devicePixelRatio` trực tiếp chẳng hạn), shim
  trở thành no-op vô hại — không cần theo dõi.
