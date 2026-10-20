# Debug Report: Session 706 trả lời lặp/lạc đề do compaction summary cũ

- **Ngày phân tích:** 2026-10-09 (giờ VN)
- **Session bị lỗi:** codeg session 706 — project xplori-app
- **Model session 706:** `z-ai/glm-5.3-flash`
- **Nguồn bằng chứng:** `~/.claude/projects/-Volumes-Media-Xplori-xplori-app/5a94538e-71c9-481c-bd1b-d19c4efd5680.jsonl` (9.4MB, 4136 dòng)
- **Trạng thái:** Đã xác định nguyên nhân gốc + phân định trách nhiệm model/agent (mục 2b) — CHƯA vá codeg, CHƯA fix bug gốc trong xplori-app

---

## 1. Tóm tắt vấn đề

Session 706 (đang debug bug "viền tròn khuyết xanh nhấp nháy" trên map marker của xplori-app) liên tục trả lời **cùng một nội dung chẩn đoán** dù user đã gửi các yêu cầu hoàn toàn khác: yêu cầu chạy probe adb, yêu cầu sửa ngay, yêu cầu tạo file report.

- **7 yêu cầu khác nhau của user** (07:04 → 08:41 giờ VN) — xem mục 3.
- **6 lần gửi lại chẩn đoán bug 3** (07:21 → 08:43 giờ VN), mỗi lần chỉ khác chút ít về câu chữ, đều kết thúc bằng câu hỏi "Bạn xác nhận phương án...?".

Session bị auto-compact **4 lần**; lần compact thứ 4 (08:15 VN) là mốc gây ra hành vi lặp nặng nhất.

---

## 2. Cơ chế gây lỗi (root cause)

### RC-1: Compact summary đóng băng ở task cũ

Summary của lần compact #4 (17211 ký tự) ghi:

```
**Current explicit request (bug 3, ACTIVE)**: ... "hiểu vấn đề và xác nhận"
```

Trong khi task "hiểu vấn đề và xác nhận" đã hoàn thành từ lâu — user sau đó đã gửi liên tiếp các yêu cầu mới: restart app xác nhận lỗi vẫn còn, chạy probe adb, làm ngay, sửa ngay đi.

### RC-2: Summary khẳng định sai trạng thái ("NO diagnosis has been written")

Summary #4 viết:

```
NO diagnosis has been written or sent to the user yet
```

Thực tế **SAI** — đã có 2 chẩn đoán được gửi cho user trước đó (00:21:49Z và 00:45:02Z). Vì tin vào câu này, model tưởng mình chưa từng chẩn đoán nên tiếp tục "chẩn đoán lần đầu" — lặp lại 4 lần nữa.

### RC-3: Preserved segment bỏ sót các user message mới nhất

Compaction #4 (01:15:28Z) giữ lại đoạn hội thoại kết thúc ở các message từ 01:12:01–01:12:05Z (tool_result đọc `ViewChangesTracker.java`). Các user message mới nhất bị **loại hoàn toàn** khỏi preserved segment:

- 01:05:48Z — "sửa ngay đi"
- và các message trước đó trong cùng cụm yêu cầu

Đồng thời danh sách "All user messages" trong summary #4 cũng **thiếu 6 message mới nhất** (fix lỗi ngay, tại sao cần rebuild apk, đã restart lại app, chạy probe adb, làm ngay, sửa ngay đi) — giống hệt summary #3, tức phần này không được cập nhật qua 2 lần compact liên tiếp.

### RC-4: Continuation directive đè lên yêu cầu mới

Sau compact, Claude Code chèn message:

```
This session is being continued from a previous conversation...
Continue the conversation from where it left off without asking the user any further questions.
Pick up the last task as if the break never happened.
```

Chỉ thị "resume the last task as if the break never happened" + summary cũ = model resume đúng task **cũ** ("chẩn đoán và xin xác nhận") thay vì xử lý các yêu cầu **mới** mà user đã gửi sau đó.

### RC-5: Bằng chứng trực tiếp từ thinking block

- 01:27:06Z: *"TypeScript clean. Now deliver the diagnosis to the user in Vietnamese. The user asked: 'hiểu vấn đề và xác nhận' — understand the problem and confirm."* → model hành động theo summary cũ, không theo message mới nhất.
- 01:23:01Z: *"Interesting — the file already contains the 'loaded' state... The summary said no fix applied yet. But the diff shows a fix was already implemented"* → model nhận ra mâu thuẫn giữa summary và working tree nhưng vẫn không thoát khỏi vòng lặp.

### RC-6: Vòng lặp đọc lại code thay vì hành động

~30 lệnh bash đọc `node_modules/react-native-maps/android/.../MapMarker.java` + `ViewChangesTracker.java` qua 4 vòng (07:06–07:21, 08:06–08:12, 08:27, 08:32–08:37 VN) — đọc lại cùng file nhiều lần thay vì thực thi yêu cầu.

---

## 2b. Phân định trách nhiệm: model hay agent (Claude Code CLI) gây lỗi?

**Kết luận: cả hai, chia vai rõ — codeg app KHÔNG gây lỗi.** Agent tạo *điều kiện* lỗi; model viết summary kém và *quyết định có lặp hay không*.

### Chuỗi thực thi thật của session 706

```
codeg (agent_type=claude_code) → claude-agent-acp 0.85.1 → Claude Agent SDK 0.3.286
→ binary claude 2.1.286 (bundled trong claude-agent-sdk-darwin-arm64)
→ ANTHROPIC_BASE_URL=localhost:20128 (9Router) → clinepass → glm-5.3-flash
```

Bằng chứng:
- Transcript ghi `version: 2.1.286`, `entrypoint: sdk-ts` (mọi message).
- Binary 225MB tại `~/.nvm/versions/node/v22.22.1/lib/node_modules/@agentclientprotocol/claude-agent-acp/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` chứa **nguyên văn** cả prompt tóm tắt (`Your task is to create a detailed summary of the conversation so far...`) lẫn câu lệnh continuation (`Continue the conversation from where it left off... Pick up the last task as if the break never happened.`).
- Codeg app (Tauri/Rust) chỉ render card compaction (`src/lib/context-compaction.ts` + `parsers/claude.rs`) — không tham gia sinh summary hay continuation.

### Phần do AGENT (deterministic, không phụ thuộc model)

| # | Bằng chứng |
|---|-----------|
| 1 | Câu lệnh continuation hardcode trong binary 2.1.286: chỉ thị resume task cũ ("Pick up the last task as if the break never happened"), đè lên yêu cầu mới của user |
| 2 | `preservedSegment` của compaction #4 chỉ giữ entry 01:12:01–01:12:05Z; message cuối của user ("sửa ngay đi", 01:05:48Z) nằm ngoài segment. Map UUID: segment tail = `d8248fc7` (attachment 01:12:05.486Z); toàn bộ 18 `allUuids` chỉ phủ 01:12:01–01:12:05Z |
| 3 | Khảo sát **315 compaction boundary** toàn máy (mọi project, mọi model): **32 lần (10%) bỏ sót message user mới nhất khỏi preserved segment** — gặp ở session deepseek-v4.1-flash, claude-opus-4-8, gemini, glm-5.3-flash → failure mode của bộ máy CLI, không riêng model nào |

### Phần do MODEL (glm-5.3-flash)

**Summary do chính model viết** — log 9Router (`~/.n9router/usage.json`): call tóm tắt lúc 01:15:27.605Z qua clinepass/glm-5.3-flash, prompt 110.260 → output 4.881 token ≈ đúng 17.211 ký tự của summary #4. Cửa sổ 01:12:08→01:15:27Z chỉ có **duy nhất** call này → không dùng model tóm tắt riêng (không phải haiku/fast model), summary do chính model chính viết.

Summary #4 sai/thiếu quan sát được:
- Mục "All user messages" **giống hệt summary #3** — thiếu toàn bộ 6 message mới trong cửa sổ 23:52–01:05Z: "fix lỗi ngay", "tại sao cần rebuild apk", "đã restart lại app…", "chạy probe trực tiếp trên android adb", "làm ngay", "sửa ngay đi"
- "Current explicit request" đóng băng ở *"hiểu vấn đề và xác nhận"*
- *"NO diagnosis has been written or sent to the user yet"* — **sai** (2 chẩn đoán đã gửi lúc 00:21:49Z và 00:45:02Z)
- Snapshot trạng thái lùi ~1 giờ so với boundary (mô tả sự kiện ~00:06–00:09Z, boundary 01:15Z)
- Sau compact: lặp 6 lần chẩn đoán; thinking có ghi nhận mâu thuẫn (*"The summary said no fix applied yet. But the diff shows a fix was already implemented"*) nhưng không tự phục hồi

### Đối chứng tách vai

| Session | Model | Summary bắt được message mới nhất? | Sau boundary |
|---------|-------|-----------------------------------|--------------|
| 706 | glm-5.3-flash | **KHÔNG** (thiếu 6 message) | **lặp 6 lần** |
| 13e65db1 (cùng project, cùng CLI 2.1.286) | glm-5.3-flash | CÓ ("vẫn lỗi marker bị mất ảnh") | tiếp tục đúng, không lặp |
| 227f71aa | deepseek-v4.1-flash + claude-opus-4-8 | KHÔNG (thiếu message mới nhất) | vẫn nhắm đúng yêu cầu mới (+18s), không lặp |

→ Điều kiện lỗi do agent tạo ra **không tự động gây lặp**; model quyết định có thoát hay không.

### Kết luận phân vai

- **Agent (Claude Code CLI 2.1.286)** = nguồn của failure mode (deterministic, 10% mọi boundary, mọi model). Đây là code Anthropic đóng gói sẵn — codeg không sửa được logic bên trong, chỉ có thể cải thiện UX cảnh báo.
- **Model glm-5.3-flash** = yếu tố quyết định trong ca 706: viết summary thiếu/sai + không tự phát hiện mâu thuẫn → biến điều kiện lỗi thành vòng lặp 6 lần.
- **Codeg app** = không gây lỗi.

### Hạn chế của phân tích phân vai

1. Không đọc được **raw input** của call tóm tắt #4 (9Router `request-details.json` chỉ giữ 55 record gần nhất) → chưa biết chắc 6 message mới có nằm trong input tóm tắt hay bị CLI cắt bớt trước khi tóm tắt. Nếu bị cắt → phần lỗi thuộc agent nhiều hơn.
2. Attribution call tóm tắt cho #1–#3 chưa khớp chắc chắn (chỉ #4 khớp chính xác cả thời gian lẫn kích thước output).
3. Cách xác minh dứt điểm chưa chạy: đổi model session sang opus/claude thật, chạy lại kịch bản — nếu vẫn lặp → agent; nếu hết → model là yếu tố quyết định trong cấu hình hiện tại.

---

## 3. Timeline (giờ VN = UTC+7)

| Giờ VN | Sự kiện |
|--------|---------|
| 07:04 | User: "đã restart lại app, mở lại màn bản đồ và vẫn còn thấy viền xanh khuyết nhấp nháy" |
| 07:05 | User: "chạy probe trực tiếp trên android adb" |
| 07:06–07:12 | Agent đọc lại MapMarker.java, ViewChangesTracker.java (~15 lệnh); adb chỉ liệt kê devices/packages — **probe không hề chạy** |
| 07:21 | ❌ Agent gửi chẩn đoán #1 (3107 ký tự), hỏi xác nhận phương án |
| 07:34 | User: "làm ngay" |
| 07:45 | ❌ Agent gửi chẩn đoán #2 (3168 ký tự), hỏi xác nhận |
| 08:05 | User: "sửa ngay đi" |
| 08:15 | ⚠️ **Auto-compact #4** (preTokens 167245 → postTokens 20918, cumulativeDroppedTokens 577016) |
| 08:20 | ❌ Agent gửi chẩn đoán #3 (2758 ký tự) |
| 08:21 | User: "fix triệt để đi chưa" |
| 08:29 | ❌ Agent gửi chẩn đoán #4 (3392 ký tự) |
| 08:31 | User: "tạo report lỗi trên" |
| 08:37 | ❌ Agent gửi chẩn đoán #5 (2332 ký tự) |
| 08:41 | User: "tạo và lưu file report của lỗi trên" |
| 08:42 | ✅ Agent tạo file report bug-3 (`plans/reports/debug-261009-0841-map-marker-blue-border-flash.md`) |
| 08:43 | ❌ Agent **vẫn** gửi chẩn đoán #6 (2909 ký tự), kết thúc "Bạn xác nhận làm theo phương án 1...?" |

### 4 lần compaction (trigger auto)

| # | Thời điểm (UTC) | preTokens | postTokens | durationMs |
|---|-----------------|-----------|------------|------------|
| 1 | 2026-10-08T15:28:14Z | 167734 | 18325 | 273925 |
| 2 | 2026-10-08T16:39:45Z | 167858 | 23471 | — |
| 3 | 2026-10-08T23:36:19Z | 169130 | 32237 | — |
| 4 | 2026-10-09T01:15:28Z | 167245 | 20918 | 202392 |

Session kết thúc ở 1000 messages, tổng input 49,796,824 tokens, output 43,132 tokens, model `z-ai/glm-5.3-flash`.

---

## 4. Trạng thái thực tế đã verify (khác với summary #4)

| Hạng mục | Summary #4 nói | Thực tế |
|----------|----------------|---------|
| Chẩn đoán | "NO diagnosis has been written" | Đã gửi 2 lần (07:21, 07:45 VN) trước compact |
| File report bug | Chưa nhắc | Đã tạo lúc 08:42 VN (7740 bytes) |
| Fix bug 3 | Chưa áp dụng | Đúng — phương án 1 (`hidden = tracking`) CHƯA apply. Working tree có fix loaded-state uncommitted (+17/−8) nhưng không phải phương án 1 |
| Probe adb | — | **Chưa từng chạy thật** — không có lệnh `input`/`screencap`/`swipe`/`tap`/`uiautomator`/`screenrecord` nào |

---

## 5. Đề xuất

### Cho codeg (cải thiện UX quanh compaction)

Lưu ý: logic compaction (preserved segment, prompt tóm tắt, continuation directive) nằm **bên trong binary Claude Code CLI 2.1.286** — codeg không sửa được. Các đề xuất dưới đây là phần codeg làm được ở tầng app:

1. **Cảnh báo summary lỗi thời**: khi user gửi message mới trong lúc/ngay sau compaction, hiển thị cảnh báo summary có thể cũ (dựa trên `compact_boundary` record đã parse trong `parsers/claude.rs`).
2. **So khớp tự động**: đối chiếu `preservedSegment.tailUuid` với message cuối cùng của user trong transcript — nếu message cuối nằm ngoài segment, đánh dấu card compaction là "có thể bỏ sót ngữ cảnh".
3. **Đề xuất hành động**: khi phát hiện session lặp (N lần trả lời cùng chủ đề sau compaction), gợi ý user mở session mới hoặc đổi model.
4. **Đề xuất ngược lên Anthropic** (không phải việc của codeg): preserved segment bắt buộc gồm N user message cuối; continuation directive nên rào điều kiện "chỉ resume task cũ nếu không có message mới hơn".

### Cho session 706 (thoát vòng lặp)

1. **Mở session mới** với chỉ thị rõ: "Implement phương án 1 (`hidden = tracking`) cho `essential-guide-map-marker.tsx`. KHÔNG chẩn đoán lại. Sau fix build APK debug + verify trên MuMu."
2. Hoặc reply trực tiếp vào 706 với cùng chỉ thị trên (rủi ro tái phát vì summary vẫn cũ).

### Cho bug 3 (xplori-app)

- Report chẩn đoán: `/Volumes/Media/Xplori/xplori-app/plans/reports/debug-261009-0841-map-marker-blue-border-flash.md`
- Phương án khuyến nghị: phương án 1 — reveal dựa trên `tracking` thay vì 2 rAF; đánh đổi marker ẩn ~400ms khi switch.

---

## 6. Câu hỏi chưa giải quyết

1. User có muốn implement phương án 1 cho bug 3 ngay không (session mới hoặc trong session này)?
2. Có muốn làm các cải thiện codeg ở mục 5.1–5.3 không (cảnh báo summary lỗi thời ở tầng app)?
3. Probe adb còn cần chạy không, hay đã đủ bằng chứng từ ảnh user cung cấp?
4. Có muốn chạy thí nghiệm xác minh dứt điểm phân vai model/agent không (đổi model session sang opus chạy lại kịch bản)?
