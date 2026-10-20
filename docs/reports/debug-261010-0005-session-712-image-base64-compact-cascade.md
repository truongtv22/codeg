# Debug Report: Session 712 — cascade compact do ảnh screenshot bị proxy dịch thành base64 text

- **Ngày phân tích:** 2026-10-10 (giờ VN)
- **Session bị lỗi:** codeg session 712 — project xplori-app (debug bug marker xanh, cùng bug với session 706)
- **Model session 712:** `deepseek-v4.1-flash` qua 9Router (provider `codebuddy-intl`)
- **Nguồn bằng chứng:**
  - Transcript: `~/.claude/projects/-Volumes-Media-Xplori-xplori-app/79249110-5af7-452d-a2d2-a2f62dc0c263.jsonl` (19.5MB, 1633 dòng, CLI 2.1.286)
  - 9Router: `~/.n9router/usage.json` (10.000 record), `request-details.json` (retention cuốn ~70–100 record)
  - Source 9Router: `/Volumes/Media/tools/n9router/open-sse/translator/request/claude-to-openai.js`, `executors/codebuddy-intl.js`, `providers/capabilities.js`
  - Test offline: `/tmp/translator-test.mjs` (chạy lại xác nhận 2026-10-10, không cần mạng)
- **Trạng thái:** Đã xác định **chuỗi nguyên nhân gốc 5 mắt xích** + phân định trách nhiệm — CHƯA vá 9Router, CHƯA áp workaround

---

## 1. Tóm tắt vấn đề

Hai dòng user trích từ codeg UI là 2 trong **18 lần compact** của session 712:

```
Context compacted • 295,190 -> 38,685 tokens   (compact #16, 14:37:11Z)
Context compacted • 196,265 -> 38,076 tokens   (compact #17, 14:39:16Z)
```

Số liệu tổng:

| Chỉ số | Giá trị |
|--------|---------|
| Thời lượng session | 12:25:25Z → 15:06:30Z ≈ **2h41m** |
| Compact | **18 lần** (17 auto + 1 manual), cumulativeDroppedTokens 4,076,865 |
| Cụm 1 | **10 compact trong 19 phút** (12:27:07 → 12:46:33Z), gap 47–336s |
| Cụm 2 | **7 compact trong 14 phút** (14:25:01 → 14:39:16Z), gap 125–162s |
| Lần đọc ảnh (tool Read trả image) | **31 lần**, tổng **5,194,164 ký tự base64** |
| Request / input tokens | 111 request / **11,252,527 input tokens** / 366,490 output |
| Kết thúc | output chạm trần 32,000 → API lỗi "Prompt is too long" → manual compact #18 (pre=343,557) |

Điểm đáng chú ý: **compact đầu tiên xảy ra chưa đầy 2 phút sau khi session bắt đầu** — session mở lúc 12:25:25Z, ảnh đầu tiên được Read lúc 12:26:16Z, context nhảy từ 31,383 → 290,662 tokens chỉ trong 53 giây, compact #1 nổ lúc 12:27:07Z.

---

## 2. Chuỗi nguyên nhân gốc (root cause chain)

### RC-1: Translator của 9Router biến ảnh trong `tool_result` thành base64 **text** trên đường truyền

`claude-to-openai.js` L199–217 — khi dịch request Anthropic → OpenAI, block `tool_result` **chỉ giữ phần text**; nếu không có text thì `JSON.stringify` toàn bộ content (kể cả base64) thành string:

```js
case CLAUDE_BLOCK.TOOL_RESULT:
  let resultContent = "";
  if (typeof block.content === "string") {
    resultContent = block.content;
  } else if (Array.isArray(block.content)) {
    resultContent = block.content
      .filter(c => c.type === CLAUDE_BLOCK.TEXT)
      .map(c => c.text)
      .join("\n") || JSON.stringify(block.content);   // <-- ảnh rơi vào đây
  } else if (block.content) {
    resultContent = JSON.stringify(block.content);
  }
  toolResults.push({ role: ROLE.TOOL, tool_call_id: block.tool_use_id, content: resultContent });
```

Không có nhánh nào cho `type: "image"`. Hệ quả **hai chiều, đều sai**:

- **Ảnh + text** (MCP `computer_screenshot`): ảnh bị **vứt im lặng**, chỉ text sống sót.
- **Ảnh đơn độc** (tool `Read` trả ảnh): không có text → `|| JSON.stringify(block.content)` → **base64 thô được gửi như text**.

Xác nhận bằng test offline chạy trực tiếp trên chính file translator (deterministic, không cần mạng):

```
CA A: tool_result CHỈ image (Read)      → role=tool len=303 hasB64=true  hasImageUrl=false
CA B: tool_result image + text (MCP)    → role=tool len=87  hasB64=false hasImageUrl=false
```

Và cấu trúc thực tế: **cả 31/31 ảnh của session 712 đều là tool_result dạng `types=['image'] text_len=0`** — tức 100% rơi vào nhánh `JSON.stringify`. (Đối chứng: `computer_screenshot` trong cf271be0 có `types=['image','text','text']` → nhánh filter text → ảnh bị drop.)

Executor `codebuddy-intl.js` không sửa gì thêm: nó chỉ ép `stream=true`, chèn system prompt, và **để nguyên message `tool`** (L29–38) → chuỗi base64 đi thẳng tới `https://www.codebuddy.ai/v2/chat/completions`.

### RC-2: Tokenizer của deepseek-v4.1-flash đếm base64 text ở ~0.694 token/ký tự

Đo từ 23 cặp request "sạch" (request N → request N+1 ngay sau một lần đọc ảnh, không có compact xen giữa) trong chính session 712 — delta input tokens tỉ lệ **tuyến tính hoàn hảo** với độ dài base64:

| Cặp | Ảnh mới (b64 chars) | Δ tokens | ratio |
|-----|--------------------:|---------:|------:|
| L1526→L1533 | 27,012 | 18,982 | 0.7027 |
| L1088→L1105 | 335,772 | 234,030 | 0.6970 |
| L1217→L1240 | 360,212 | 250,716 | 0.6960 |
| L129→L141 | 355,600 | 247,150 | 0.6950 |
| L1049→L1056 | 335,772 | 233,041 | 0.6940 |
| L1542→L1552 | 336,112 | 233,158 | 0.6937 |
| L478→L487 | 184,064 | 127,624 | 0.6934 |
| … (23 cặp) | | | **0.684 – 0.726, median ≈ 0.694** |

Nghĩa là ~1 token / 1.44 ký tự base64. Hệ quả trực tiếp:

- Ảnh screenshot 306×582 PNG (123k b64) ≈ **85k tokens**
- Ảnh full-res (356k b64) ≈ **247k tokens**
- Ảnh lớn nhất (680k b64, session cf271be0) ≈ **472k tokens**

**Một ảnh duy nhất đã vượt ngưỡng auto-compact ~165k.** Với 31 ảnh, riêng delta lần-đầu của ảnh đã cộng ~3.6M tokens vào context (ảnh còn được gửi lại ở mọi request sau đó cho tới lần compact kế tiếp — chi phí thật cao hơn nhiều lần con số này).

### RC-3: `preservedSegment` gửi lại ảnh ngay sau compact → tái vượt ngưỡng trong 1–2 request

Compact của Claude Code giữ lại một đoạn message gần nhất verbatim (`preservedSegment`). Khi đoạn đó chứa message đọc ảnh, request kế tiếp **cõng lại toàn bộ base64** → context vượt ngưỡng lần nữa → compact tiếp. Đây là cơ chế cascade.

Forensic 3 compact liên tiếp cụm 2 (số liệu từ compactMetadata + usage của request kế tiếp):

| Compact | pre → post | Đoạn giữ lại chứa | usage_in request kế tiếp | Δ = usage_in − post |
|---------|-----------|-------------------|--------------------------|---------------------|
| #15 (14:34:31Z) | 187,283 → 25,903 | ảnh b64 335,984 (L1323) | 276,512 (L1353, 14:35:38Z) | **+250,609** |
| #16 (14:37:11Z) | 295,190 → 38,685 | ảnh b64 192,116 (L1361+L1366) | 177,740 (L1404, 14:38:27Z) | **+139,055** |
| #17 (14:39:16Z) | 196,265 → 38,076 | **không ảnh** | 45,615 (L1441, 14:39:20Z) | **+7,539** (ổn định) |

#17 là đối chứng quyết định: cùng cơ chế compact, chỉ khác segment không chứa ảnh → context ổn định ở ~45k, **không compact lại**.

### RC-4: Model không hề thấy ảnh (chỉ nhận base64 text) → hoang mang → đọc lại ảnh nhiều lần

Vì wire payload là tool message chứa base64 **text**, deepseek-v4.1-flash không có pixel nào để nhìn. Thinking block tại L1404 (14:38:27Z, ngay giữa compact #16 và #17) tự mâu thuẫn:

> "...actually I can't see the images in the text, but they were returned"
> "But since I can see the images in my context (they were rendered), let me reason about what they showed."
> "OK here's the thing: I genuinely can see the images in my multimodal context."

Model dao động giữa "không thấy" và "thấy", cuối cùng tự huyễn là thấy, rồi tiếp tục chụp/đọc ảnh mới để "kiểm chứng" → **mỗi vòng lặp đọc ảnh là +85k–250k tokens** → nuôi cascade. 31 lần đọc ảnh trong 2h41m chính là biểu hiện của vòng lặp này.

### RC-5: Lệch ngưỡng CLI (~165k) vs provider (~361k+), kết thúc bằng trần output

- Ngưỡng auto-compact của CLI ≈ **163–165k tokens** (đo từ session đối chứng không ảnh `f59e7fb5`: request lớn nhất không bị compact 165,422; request nhỏ nhất bị compact 162,948). Trong 712: request nhỏ nhất bị compact 165,178 (L892).
- Provider codebuddy-intl thực tế nhận request input tới **361,650 tokens** (L1184, 14:28:02Z, thành công) — trong khi 9Router khai `contextWindow: 1000000` cho model này (`capabilities.js` L215). Tức CLI compact ở ~165k theo giả định cửa sổ 200k, còn provider chịu tới ~360k+.
- Kết thúc: request L1552 (14:48:03Z) input 311,506, **output chạm trần 32,000** (bị cắt); request kế tiếp bị provider từ chối **"Prompt is too long"** (L1556, 14:53:17Z); user phải chạy **manual compact #18** (15:00:24Z, pre=343,557, duration 413,795ms ≈ 6.9 phút). Session kết thúc 15:06:30Z.

---

## 3. Bằng chứng đo lường (đối chứng chéo 4 session)

| Session | Model | Loại ảnh | Ratio (token/char b64) | Diễn giải |
|---------|-------|----------|------------------------|-----------|
| **712** | deepseek-v4.1-flash | Read (ảnh đơn độc) | **0.684–0.726** | base64 thành text, tokenizer đắt |
| cf271be0 | deepseek-v4.1-flash | `computer_screenshot` (ảnh+text) | **0.0016–0.0065** | ảnh bị drop, chỉ text 363 ký tự được đếm |
| cf271be0 | deepseek-v4.1-flash | Read (ảnh đơn độc) | 0.675–0.716 | như 712 |
| cf271be0 | claude-haiku-5.5 | Read (ảnh đơn độc) | **0.250–0.252** | cùng wire format, tokenizer khác |
| 13e65db1 | z-ai/glm-5.3-flash | Read (ảnh đơn độc) | **0.250–0.252** | cùng wire format, tokenizer khác |
| 13e65db1 | deepseek-v4.1-flash | Read (ảnh đơn độc) | 0.570–0.715 | như 712 |
| f59e7fb5 (không ảnh) | — | — | — | dùng đo ngưỡng ~163–165k |

Kết luận từ đối chứng:

1. **Cùng một wire format** (base64 stringify), chỉ khác tokenizer: deepseek ~0.69 vs claude/glm ~0.25 → deepseek đắt **~2.8×** trên cùng nội dung.
2. **Bug không riêng deepseek**: session 13e65db1 (glm) cũng có **19 compact / 154 request**, cf271be0 có **40 compact / 401 request** — ảnh Read bị stringify là bệnh chung của mọi session đọc screenshot qua 9Router; deepseek chỉ làm nó trầm trọng hơn.
3. Ratio ảnh MCP (`computer_screenshot`) ~0.002 xác nhận nhánh filter-text trong code: ảnh + text → ảnh bị drop hoàn toàn.

Nguồn wire-level bổ sung: các record `providerRequest` còn giữ (16:41–16:46Z cùng ngày, session phân tích này) cho thấy message `role=tool` chứa **run base64 thô ≥14k ký tự** đi nguyên vẹn tới provider — khớp với hành vi `JSON.stringify` của translator.

---

## 4. Timeline

### Cụm 1 — 10 compact / 19 phút (12:27:07 → 12:46:33Z)

Mẫu lặp: **đọc ảnh → compact → đọc ảnh → compact**:

```
L 132 IMG 355,600  →  L 156 COMPACT #1   (12:27:07, pre=292,569)
L 236 IMG 355,020  →  L 258 COMPACT #2   (12:29:20, pre=295,681)
L 311 IMG 355,616  →  L 326 COMPACT #3   (12:31:12, pre=293,370)
L 352/362 IMG      →  L 369 COMPACT #4   (12:31:59, pre=174,497, gap 47s)
L 482 IMG 184,064  →  L 497 COMPACT #5   (12:34:24, pre=198,458)
L 523 IMG 191,780  →  L 540 COMPACT #6   (12:35:23, pre=178,895)
L 566 IMG 181,344  →  L 583 COMPACT #7   (12:36:12, pre=171,332)
L 610/615 IMG      →  L 712 COMPACT #8   (12:41:48, pre=285,848)
L 738/743/764/769  →  L 784 COMPACT #9   (12:43:41, pre=226,935)
L 810 IMG 171,660  →  L 904 COMPACT #10  (12:46:33, pre=171,793)
```

### Khoảng lặng 98 phút → Cụm 2 — 7 compact / 14 phút (14:25:01 → 14:39:16Z)

| Giờ (UTC) | Sự kiện | preTokens | Gap |
|-----------|---------|-----------|-----|
| 14:22:19 | Read ảnh L1051 (335,772 b64 → +233k tokens) | | |
| 14:25:01 | COMPACT #11 | 287,504 | |
| 14:25:17 | Read ảnh L1092 (335,772 b64 → +234k) | | |
| 14:27:08 | COMPACT #12 | 276,016 | 126s |
| 14:27:42 | Read ảnh L1171+L1179 (110k+336k b64 → +309k) | | |
| 14:29:38 | COMPACT #13 | **365,957** | 150s |
| 14:30:01 | Read ảnh L1222+L1227 (25k+336k b64 → +251k) | | |
| 14:31:49 | COMPACT #14 | 305,798 | 131s |
| 14:32:32 | Read ảnh L1306+L1314 (165k+27k b64 → +133k) | | |
| 14:34:31 | COMPACT #15 | 187,283 | 162s |
| 14:35:38 | Request kế tiếp cõng lại ảnh L1323 → +250,609 | | |
| 14:35:38 | Read ảnh L1361+L1366 (165k+27k b64 → +139k) | | |
| 14:37:11 | **COMPACT #16** (dòng user trích) | **295,190** | 160s |
| 14:38:27 | Thinking L1404 hoang mang về ảnh; request +139,055 | | |
| 14:39:16 | **COMPACT #17** (dòng user trích) | **196,265** | 125s |
| 14:39:20 | Request kế tiếp +7,539 (ổn định — segment không ảnh) | | |
| 14:45:36 | Read ảnh L1547 (336,112 b64 → +233,158) | | |
| 14:48:03 | Request input 311,506, **output chạm trần 32,000** | | |
| 14:53:17 | ❌ API error **"Prompt is too long"** (L1556) | | |
| 15:00:24 | **COMPACT #18 (manual)** — pre=343,557 → post=21,468, dur 413,795ms | 343,557 | 1,268s |
| 15:06:30 | Session kết thúc | | |

---

## 5. Phân định trách nhiệm

| Thành phần | Vai trò | Kết luận |
|------------|---------|----------|
| **9Router translator** (`claude-to-openai.js` L199–217) | **Nguyên nhân gốc trực tiếp** | Biến ảnh trong tool_result thành base64 text (ảnh đơn độc) hoặc vứt ảnh (ảnh+text). Sửa được, deterministic. |
| Tokenizer provider (codebuddy-intl → deepseek-v4.1-flash) | **Hệ số khuếch đại** | 0.694 token/char trên base64 — gấp 2.8× claude/glm (0.25). Không kiểm soát được từ phía client. |
| **Claude Code CLI 2.1.286** | **Cơ chế cascade** | `preservedSegment` gửi lại message chứa ảnh sau mỗi compact (RC-3); ngưỡng auto-compact ~165k theo giả định cửa sổ 200k, lệch với provider (~361k+) — code Anthropic đóng gói, không sửa được. |
| Model deepseek-v4.1-flash | **Vòng lặp** | Không thấy ảnh nhưng tưởng thấy → đọc lại ảnh (RC-4). Là hệ quả của RC-1, không phải nguyên nhân độc lập. |
| `capabilities.js` khai `vision: true` | Yếu tố phụ | `stripUnsupportedModalities` không strip gì (vision=true) — nhưng kể cả strip cũng khó cứu vì stripper không đi vào tool_result. Khai báo này che mất vấn đề. |
| **codeg app** | **Không gây lỗi** | Chỉ render compact card + transcript từ `compactMetadata`; không tham gia translate/summary. |

---

## 6. Đề xuất

### 6.1 Fix gốc tại 9Router — `claude-to-openai.js` L199–217

Không bao giờ để base64 lọt vào text. Patch tối thiểu (giữ nguyên shape message `tool`):

```js
case CLAUDE_BLOCK.TOOL_RESULT: {
  let resultContent = "";
  if (typeof block.content === "string") {
    resultContent = block.content;
  } else if (Array.isArray(block.content)) {
    const texts = block.content.filter(c => c.type === CLAUDE_BLOCK.TEXT).map(c => c.text);
    const nImgs = block.content.filter(c => c.type === "image").length;
    resultContent = texts.join("\n")
      || (nImgs > 0
            ? `[${nImgs} image(s) omitted by proxy — không thể forward ảnh trong tool result]`
            : JSON.stringify(block.content));
  } else if (block.content) {
    resultContent = JSON.stringify(block.content);
  }
  toolResults.push({ role: ROLE.TOOL, tool_call_id: block.tool_use_id, content: resultContent });
  break;
}
```

Nâng cấp (cần test trước): forward ảnh thật bằng content array dạng `[{type:"text"}, {type:"image_url", image_url:{url:"data:image/png;base64,..."}}]` trong message `tool` — OpenAI Chat Completions mới hỗ trợ multi-part tool output, nhưng **chưa xác minh gateway codebuddy.ai chấp nhận** (câu hỏi mở #3).

Kiểm tra kèm: bản build `.next/standalone/open-sse/translator/request/claude-to-openai.js` đã được đối chiếu **giống hệt** source — patch source xong phải rebuild.

### 6.2 Workaround vận hành (áp dụng được ngay, không sửa code)

1. **Không dùng tool `Read` để đọc ảnh screenshot với model deepseek-v4.1-flash qua codebuddy-intl** — mỗi ảnh +85k đến +250k tokens.
2. Nếu cần model "nhìn" ảnh trong lúc debug: crop/downscale/JPEG trước khi Read. Ảnh 306×582 PNG ≈ 85k tokens; ảnh crop 100×100 ≈ 6.7k tokens. Ngân sách an toàn: giữ mỗi ảnh < ~20k tokens (≈ <30k b64 chars).
3. `computer_screenshot` / `browser_screenshot` (MCP): ảnh **không tốn token** (bị drop) nhưng model **cũng không thấy ảnh** — chỉ dùng khi cần metadata/path, không dùng khi cần model nhìn pixel.
4. Chuyển session sang model tokenizer rẻ hơn (glm-5.3-flash, claude-haiku-5.5: 0.25 tok/char — vẫn 89k tokens/ảnh full-res) hoặc model Anthropic chính chủ (đường Anthropic native không bị translator stringify, ảnh được truyền đúng dạng image block).
5. Session 712 nên bỏ; tạo session mới với chỉ thị rõ (bug marker xanh tiếp tục từ report 706).

### 6.3 Cho codeg (tùy chọn, tầng UX)

- Phát hiện "compact cascade" (≥2 compact boundary cách nhau < 3 phút trong transcript đã parse) → hiển thị cảnh báo + gợi ý kiểm tra ảnh/đổi model.
- Thống kê token theo tool result chứa ảnh (từ usage delta) → cảnh báo chi phí trước khi user Read ảnh lớn.

---

## 7. Hạn chế phân tích

1. **Raw payload cửa sổ 14:37–14:39Z (compact #16/#17) không còn** — `request-details.json` retention cuốn ~70–100 record, cửa sổ này đã aged-out trước khi dump. Bằng chứng cho #16/#17 đến từ: (a) test offline trên chính code translator, (b) delta tokens của cặp request sạch, (c) cấu trúc 31/31 tool_result ảnh đơn độc trong transcript — ba nguồn độc lập khớp nhau.
2. Ratio token/char đo gián tiếp từ usage provider báo về (không đo trực tiếp tokenizer nội bộ của gateway).
3. Số "3.6M tokens ảnh" chỉ là tổng delta lần-đầu; chi phí thật (ảnh gửi lại mỗi request tới lúc compact) cao hơn, chưa lượng hóa được chính xác.
4. Nghịch lý ngưỡng provider: request 361,650 tokens từng thành công (L1184) nhưng request ~343,557 bị "Prompt is too long" (L1556) — chưa giải thích được (xem câu hỏi #1).

---

## 8. Câu hỏi chưa giải quyết

1. Vì sao request ~343,557 tokens bị "Prompt is too long" trong khi request 361,650 tokens (L1184) từng thành công? (max_tokens khác nhau giữa 2 loại request? route khác? transient?) — cần bắt raw request/response, nhưng retention đã hết.
2. Tokenizer thật đứng sau `codebuddy-intl` cho `deepseek-v4.1-flash` là gì, và vì sao đắt gấp 2.8× claude/glm trên cùng chuỗi base64?
3. Gateway `codebuddy.ai/v2/chat/completions` có chấp nhận message `tool` với content array chứa `image_url` không? (quyết định giữa fix "forward ảnh" hay "placeholder text")
4. `stripUnsupportedModalities` của 9Router có đi vào bên trong `tool_result` không? Nếu có → đặt `vision:false` cho deepseek-v4.1-flash là chốt chặn rẻ thứ hai.
5. User có muốn tôi patch trực tiếp `claude-to-openai.js` trong n9router (kèm rebuild + test offline) không, hay giữ nguyên report?
6. Có cần điều tra vì sao `capabilities.js` khai `contextWindow: 1000000` trong khi provider chặn thực tế thấp hơn nhiều không?
