# Recommendation: Xử lý `/clear` trong Codeg — rollover transcript & lịch sử phiên

- **Ngày:** 2026-10-12 (giờ VN)
- **Trạng thái:** **ĐỀ XUẤT — chưa triển khai.** Mọi mục ở phần "hành vi hiện tại" đã kiểm chứng trong code; phần thiết kế chỉ là khuyến nghị.
- **Phạm vi:** Claude Code (`claude_code`) — agent duy nhất được reinject `/clear` vào slash menu (commit `70a8326a`, 2026-10-11, đã trên `main`).
- **Baseline code:** nhánh `main` tại `5534de1f` + các thay đổi **chưa commit** trong working tree tại `src-tauri/src/acp/background_watch.rs` và `src-tauri/src/acp/connection.rs` (ghi rõ ở mục 2.5). Nếu các thay đổi đó chưa được commit, số dòng có thể lệch.
- **Không trùng với report hiện có:** `debug-261009-*`, `debug-261010-*` (session 706/712/718) — không report nào bàn về `/clear`/rollover.

---

## 1. Bối cảnh & mục tiêu

`/clear` là lệnh CLI-local của Claude Code: nó **không** xoá file transcript cũ; CLI chuyển sang một file `{uuid-mới}.jsonl` trong cùng project directory, còn ACP session id thì không đổi. Codeg hiện đã có hạ tầng theo dõi rollover này, nhưng **chưa có UI lịch sử phiên**: sau `/clear`, nội dung trước clear nằm ngoài tầm nhìn người dùng (không có đường xem lại trong cùng conversation).

Mục tiêu đề xuất (theo yêu cầu):

1. Conversation UI giữ **ID ổn định** (numeric conversation id không đổi qua clear).
2. `/clear` tạo **session/transcript mới làm session hoạt động** (active).
3. Session cũ **giữ nguyên để xem lại**.
4. **Hiển thị lịch sử phiên** trong UI.
5. Phân biệt rõ **xem lại transcript** (read-only, đọc từ file) với **resume/tiếp tục agent session** (gửi prompt vào một session sống).

---

## 2. Hành vi hiện tại đã kiểm chứng trong code

### 2.1 `/clear` đi vào hệ thống thế nào

- claude-agent-acp strip `/clear` khỏi `available_commands_update` (`UNSUPPORTED_COMMANDS`), nhưng CLI vẫn thực thi khi gõ. Codeg reinject entry vào slash menu cho `claude_code` — `src/components/chat/message-input.tsx:970-989`. Menu row gửi đúng literal `/clear` như gõ tay.
- Backend nhận diện ở phía gửi prompt: `PromptLedger::record_prompt_blocks` (`src-tauri/src/acp/background_watch.rs:321-349`) — fingerprint `"/clear"` hoặc bắt đầu `"/clear "` (dòng 335) thì stamp `clear_sent_at` (`background_watch.rs:336-339`).
- `clear_sent_at` là **bằng chứng duy nhất** gắn rollover với connection đã yêu cầu clear, vì trên disk không có gì link file successor về file cũ (`background_watch.rs:248-256`). Cửa sổ expectation = `CLEAR_ROLLOVER_MAX_GAP_SECS` = 300s (`background_watch.rs:228-229`; `src-tauri/src/parsers/claude.rs:1312`).

### 2.2 Watcher phát hiện & adopt rollover

- Mỗi tick, watcher chỉ tìm successor khi `ledger.clear_rollover_expected()` (`background_watch.rs:1020`); tìm thấy thì `consume_clear_request()` + `adopt_rollover()` (`background_watch.rs:1023-1035`).
- `find_clear_rollover_successor` (`claude.rs:1214-1276`): dò file sibling có head record `<command-name>/clear</command-name>` trong cửa sổ thời gian (tolerance ±5s quanh last record, max gap 300s — `claude.rs:1298-1317`).
- `adopt_rollover` (`background_watch.rs:890-902`): giữ nguyên ACP `session_id` và task accounting, reset episode state, trỏ watch sang file mới; ghi `rolled_over_id` để lookup các tick sau (`background_watch.rs:994-998`).
- Sau adopt, connection loop emit `AcpEvent::TranscriptRolledOver { transcript_id }` (`background_watch.rs:576-590`; variant + doc tại `src-tauri/src/acp/types.rs:488-493`).

### 2.3 Lifecycle re-point `external_id` **in place**

- Arm `TranscriptRolledOver` tại `src-tauri/src/acp/lifecycle.rs:358-390`: gọi `conversation_service::bind_external_id(cid, transcript_id, continues=[external_id hiện tại của row])`. Comment ghi rõ: ACP session id trên `SessionState` **không đổi** (prompt vẫn dùng nó); dùng pointer hiện tại của row (không phải ACP id) làm `continues` để lần clear thứ hai không split sidebar.
- `bind_external_id` (`src-tauri/src/db/service/conversation_service.rs:656-661`): khi id cũ nằm trong `continues`, đi nhánh advance-in-place (`conversation_service.rs:785-791`) — row chỉ đổi `external_id`, **không tạo row mới**. Unique index `(external_id, agent_type)` giữ một chủ sở hữu cho mỗi transcript.
- **Hệ quả:** conversation id (i32, dùng cho `codeg://session/<id>` — `docs/url-scheme.md`) ổn định; nhưng **id transcript cũ bị bỏ hoàn toàn** — không lưu ở đâu trong DB.

### 2.4 Reopen & follow-chain

- `ClaudeParser::get_conversation` follow chuỗi rollover trên disk: `follow_clear_rollover_chain` (`claude.rs:1650-1660`, chain tối đa 32 bước — `claude.rs:1278-1296`). Reopen một conversation luôn hiển thị **transcript mới nhất**.
- `get_folder_conversation_core` (`src-tauri/src/commands/conversations.rs:1356-1360`) khi parser resolve id khác thì persist lại qua `bind_external_id` với `continues` = id row đang giữ (`conversations.rs:1458-1497`); nếu id mới đã bị row khác giữ thì giữ nguyên id cũ + log warn (dòng 1488-1496).

### 2.5 Turn-end của `/clear` — thay đổi **working tree, CHƯA commit**

`/clear` trả `end_turn` **không có output**. Trước fix, turn exit chẩn đoán "empty turn" → toast `turn_failed_empty` + row chuyển `Cancelled` mỗi lần clear (comment dẫn chứng session 727, `src-tauri/src/acp/connection.rs:11845-11854`). Working tree hiện có:

- `record_prompt_blocks` trả về `is_clear` (`background_watch.rs:316-348`, working tree);
- `connection.rs:11276` nhận verdict, `connection.rs:11861-11869` bỏ qua empty-turn diagnosis cho clear-turn; steer `/clear` cộng dồn cùng cờ (`connection.rs:12166-12167`);
- test `a_clear_turn_ends_clean_while_a_silent_one_still_reports_empty` (`connection.rs:33532`) + `record_prompt_blocks_reports_clear` (`background_watch.rs:3855`) — cũng trong working tree.

### 2.6 Frontend

- Event `transcript_rolled_over` là **no-op** ở client: `src/contexts/acp-connections-context.tsx:5099-5102` ("Backend re-points conversation.external_id… do not reconnect"); type tại `src/lib/types.ts:2653-2659`.
- Status row do lifecycle ghi theo stop reason (`lifecycle.rs:240-267`): `end_turn` → `PendingReview`; failure → `Cancelled`. Enum trạng thái hiện có: `InProgress / PendingReview / Completed / Cancelled` (`src-tauri/src/db/entities/conversation.rs:7-16`) — **không có** trạng thái cho episode đã bị clear.

### 2.7 Tóm tắt khoảng trống so với mục tiêu

| Mục tiêu | Hiện trạng |
|---|---|
| ID ổn định | ✅ Đã có (advance in place, mục 2.3) |
| `/clear` tạo session mới active | ✅ Đã có (adopt + re-point) |
| Session cũ giữ nguyên để xem lại | ⚠️ File cũ còn nguyên trên disk (test khẳng định "pre-clear content stays on the abandoned file" — `background_watch.rs:2325-2328`) nhưng **không có đường xem trong UI** |
| Hiển thị lịch sử phiên | ❌ Chưa có |
| Phân biệt view vs resume | ❌ Chưa có khái niệm episode; chưa có UI/API cho view |

---

## 3. Đề xuất thiết kế (CHƯA triển khai)

### 3.1 Nguyên tắc

1. **Conversation = thực thể ổn định** (row id, sidebar, URL scheme giữ nguyên).
2. **Transcript episode** = một `{uuid}.jsonl` gắn với một khoảng thời gian hoạt động của conversation. `/clear` (và các sự kiện tương tự) tạo episode mới; episode cũ chuyển sang trạng thái "đã kết thúc, còn xem được".
3. **Episode cũ là read-only, đọc trực tiếp từ file cũ** — không resume agent session trên nó trừ khi có quyết định riêng (mục 4).
4. Khi re-point (mục 2.3), **ghi lại id cũ vào lịch sử episode** thay vì bỏ.

### 3.2 Dữ liệu tối thiểu

| Trường | Ý nghĩa | Có sẵn trong code? |
|---|---|---|
| `conversation_id` | ID ổn định của row | ✅ `conversation.id` |
| `external_id` | UUID transcript của từng episode | ✅ chỉ giữ id hiện tại; **id cũ bị bỏ** |
| Thứ tự (order/index) | Episode thứ n trong conversation | ❌ suy từ thứ tự rollover khi chạy |
| `started_at` / `ended_at` | Biên thời gian của episode | ❌ suy từ timestamp file; chưa lưu |
| Trạng thái | current / đã kết thúc | ❌ suy ra được: episode có `ended_at IS NULL` = current |
| Lý do kết thúc | `clear` / `fork` / session switch / import | ❌ chưa có; hiện chỉ phân biệt được `clear` qua event `TranscriptRolledOver` |
| Current pointer | Episode đang hoạt động | ✅ = `conversation.external_id` hiện tại |

Lưu ý kỹ thuật quan trọng: muốn "xem lại episode cũ" **không thể** gọi `get_conversation(old_id)` qua parser Claude hiện tại — parser sẽ `follow_clear_rollover_chain` tới file mới nhất (`claude.rs:1650-1660`) và trả nhầm nội dung. Cần một đường đọc "no-follow" (chỉ đọc đúng file của episode).

### 3.3 Luồng rollover đề xuất (phần mới in nghiêng)

1. (giữ nguyên) Gửi `/clear` → nhận diện → stamp expectation (mục 2.1).
2. (giữ nguyên) Watcher tìm successor → `adopt_rollover` → emit `TranscriptRolledOver` (mục 2.2).
3. *(mới)* Lifecycle, **trước khi** advance `external_id`: đóng episode cũ (`ended_at = now`, `end_reason = clear`, giữ `external_id` cũ) rồi mở episode mới (`started_at = now`, current).
4. *(mới)* UI đọc danh sách episode của conversation, đánh dấu episode cuối là current; chọn episode cũ → load read-only qua đường đọc no-follow.
5. (giữ nguyên) Prompt tiếp theo vẫn đi vào session sống (ACP id không đổi) — không liên quan episode đang xem.

### 3.4 UI (định hướng)

- Một entry point trong conversation (ví dụ dropdown/tab "Phiên" cạnh tiêu đề) liệt kê các episode theo thời gian, kèm lý do kết thúc.
- Episode current = màn hình chat hiện tại; episode cũ mở ở chế độ read-only, có banner phân biệt rõ "đang xem lịch sử".
- Không tự động gộp episode cũ thành row sidebar (tránh xung đột với Import local sessions và unique index).

---

## 4. Điểm chưa quyết định

1. **Nơi lưu episode**: bảng mới (`conversation_transcript_episode`) vs cột JSON trên row vs chỉ suy từ disk khi cần.
2. **Backfill**: rollover xảy ra khi codeg không chạy (clear từ terminal ngoài) chỉ được parser phát hiện khi reopen — có backfill episode lịch sử không, và gán thứ tự/lý do thế nào (heuristic disk có thể nhận diện chuỗi, nhưng không có link ngược — mục 2.1)?
3. **Resume episode cũ**: chỉ view-only, hay cho phép mở lại episode cũ như một conversation/session mới? Nếu cho resume, xử lý ra sao khi agent session sống đang trỏ transcript mới (ACP id không đổi)?
4. **Dọn file**: Claude CLI có thể xoá transcript cũ sau thời gian retention; episode trỏ vào file đã mất thì UI hiển thị gì?
5. **Phạm vi agent**: chỉ Claude hay mở cho agent khác có cơ chế rollover tương tự?
6. **Quyền sở hữu id cũ**: nếu user import file cũ thành row riêng (Import local sessions), episode lịch sử và row import cùng trỏ một `external_id` — chốt quy tắc hiển thị/dedup.
7. **Đồng bộ đa client/server mode**: episode là dữ liệu DB local — cần cùng nguồn khi chạy `codeg-server`/mobile.

---

## 5. Kiểm thử cần thiết

**Đã có (giữ xanh, không hồi quy):**

- `record_prompt_blocks_reports_clear` — nhận diện clear + boundary (`background_watch.rs:3855`, working tree).
- `clear_rollover_adopts_the_new_transcript_while_acp_id_stays` (`background_watch.rs:2269`) — file mới được adopt, ACP id giữ nguyên, nội dung pre-clear không lẫn vào tail.
- `clear_rollover_ignores_a_sibling_session_we_did_not_clear` (`background_watch.rs:2339`).
- `handle_event_clear_rollover_repoints_external_id_in_place` (`lifecycle.rs:1837`) — 2 lần rollover liên tiếp vẫn ở in-place.
- `a_clear_turn_ends_clean_while_a_silent_one_still_reports_empty` (`connection.rs:33532`, working tree) — kèm negative control.
- Parser: `find_clear_rollover_successor_picks_the_new_transcript` (`claude.rs:4796`).

**Cần thêm cho tính năng episode history (khi triển khai):**

- Sau 2 lần `/clear` liên tiếp: episode list có 3 mục đúng thứ tự, current = mục cuối, 2 mục cũ có `end_reason = clear`.
- Đọc episode cũ trả **đúng nội dung file cũ** (đường no-follow; test bắt buộc vì follow-chain sẽ trả file mới nhất nếu quên bypass).
- Re-point không tạo sidebar clone (đã có test nền — phải tiếp tục xanh khi thêm ghi episode).
- Reopen conversation sau clear (parser follow-chain) vẫn trả episode mới nhất làm current.
- Clear xảy ra ngoài codeg (không có event) → reopen: hành vi backfill đã chốt.
- Frontend: event `transcript_rolled_over` không làm mất episode cũ khỏi store khi UI history đang mở.

---

## 6. Rủi ro

| Rủi ro | Mức | Ghi chú |
|---|---|---|
| Đọc episode cũ quên bypass follow-chain | Cao | Trả nhầm nội dung file mới nhất — sai âm thầm, cần test chuyên biệt |
| Ghi episode làm chậm/khó luồng re-point hiện tại | Thấp | Re-point là đường critical; ghi episode nên cùng transaction hoặc best-effort có log |
| Xung đột với Import local sessions / unique index | Trung bình | Chốt quy tắc ownership trước khi làm UI |
| File cũ bị retention xoá | Trung bình | UI cần trạng thái "nội dung không còn" |
| Phình dữ liệu episode | Thấp | Mỗi clear = 1 bản ghi nhỏ |

---

## 7. Câu hỏi mở (cần chốt trước khi triển khai)

1. Episode cũ: chỉ xem, hay cho resume thành session mới?
2. Có cần backfill lịch sử clear trước khi tính năng ra đời không?
3. Entry point UI: gắn ở conversation header, panel riêng, hay nơi khác?
4. Có mở rộng cho agent khác ngoài Claude không?
