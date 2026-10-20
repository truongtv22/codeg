# Debug Report: Session 718 — không assign được cho Antigravity do delegation bị withhold

- **Ngày phân tích:** 2026-10-10 (giờ VN)
- **Session bị lỗi:** codeg session 718 — "assign cho agent [@Google Antigravity](codeg://agent/antigravity) xử lý kiểm tra ảnh"
  - Agent cha: `claude_code` (claude-agent-acp), project xplori-app, external `3bebfdda-2c22-4c53-b8e2-8f7dceb12102`
  - Connection: `7edff7fd-d12b-4cc3-9f84-7efb6293f78c` (spawn 00:53:35Z)
- **Trạng thái:** Đã xác định nguyên nhân gốc. Fix = tắt một switch per-agent (config), KHÔNG cần sửa code. Chưa áp dụng.

---

## 1. Hiện tượng

- User gõ `assign cho agent [@Google Antigravity](codeg://agent/antigravity) xử lý kiểm tra ảnh` (01:30:27Z).
- Model gọi tool `SendMessage` (tool agent-teams của Claude Code, KHÔNG phải codeg) và nhận:

```
{"success":false,"message":"No agent named 'Google Antigravity' is reachable.\nUse ListAgents to see everyone you can message."}
```

- Không có delegation card, không có child conversation nào của 718 trong DB.
- Model kết luận sai: "Có thể Antigravity chưa chạy trên máy này" — thực tế Antigravity enabled + installed bình thường (session 719 antigravity chạy cùng lúc).

## 2. Nguyên nhân gốc (1 mắt xích)

`claude_code` có `CODEG_ACP_HOST_TOOLS=agent` trong `env_json` (Settings → Agents → Claude Code → switch "Let the agent handle files and commands" đang BẬT).

Chuỗi hệ quả trong code:

1. `HostToolsPolicy::Agent` → `hosts_channels() == false` (`src-tauri/src/acp/host_tools_policy.rs:100`)
2. `delegation_enabled = delegation_configured && host_tools.hosts_channels()` = **false** (`src-tauri/src/acp/connection.rs:5583`)
3. Companion codeg-mcp vẫn được inject nhưng `--features` **không có `delegation`** → LLM không thấy tool `delegate_to_agent` (`connection.rs` `companion_features_arg`)
4. `append_agent_routes(blocks, delegation_enabled=false)` return sớm → prompt **không có routing frame** `codeg_internal_agent_routes` (`src-tauri/src/acp/agent_mentions.rs:102`)
5. Prompt chỉ còn text `[@Google Antigravity](codeg://agent/antigravity)` trần. Claude Code có tool `SendMessage` cùng hình dạng "gửi cho agent khác" nên fallback sang nó — nhưng SendMessage chỉ nhắm peer session claude, không bao giờ tới Antigravity.

Đây là hành vi **có chủ đích của thiết kế** (switch mô tả rõ: "Delegating to other agents is also turned off..."), nhưng user không có tín hiệu nào ở lúc soạn tin.

## 3. Bằng chứng

| # | Bằng chứng | Nguồn |
|---|-----------|-------|
| 1 | `agent_setting.env_json` của `claude_code` chứa `"CODEG_ACP_HOST_TOOLS":"agent"` | `codeg.db` |
| 2 | 4 dòng log `[delegation] multi-agent delegation is enabled in settings but withheld from connection ...: CODEG_ACP_HOST_TOOLS=agent ...` (00:53:35 / 01:27:34 / 01:31:15 / 01:38:07) — connection của 718 là 1 trong 4 | `~/.codeg/logs/codeg.2026-10-10.log` (dòng 68, 404, 655, 758) |
| 3 | Process codeg-mcp của session 718 (và 720 hiện tại) chạy `--features feedback,ask,sessions,automations,taskboard,browser,browser_eval,computer` — **thiếu `delegation`** | `ps` |
| 4 | Transcript 718: **0** hit `delegate_to_agent`, **0** frame `codeg_internal_agent_routes`; deferred tool list của codeg-mcp có 31 tool nhưng thiếu đúng `delegate_to_agent` | `3bebfdda....jsonl` |
| 5 | Đối chứng THÀNH CÔNG: session 682→683 (Oct 5, `delegate_to_agent` gọi OK) và 652→653 (Oct 3) — cả hai đều có frame + tool | transcript + `conversation` table |
| 6 | Timeline flip: dòng cuối `host tools codeg` cho ClaudeCode = Oct 7 **05:27:00Z**; dòng đầu `host tools agent` = Oct 7 **06:36:26Z** | `~/.codeg/logs/codeg.2026-10-07.log` |
| 7 | Setting `delegation.enabled = true`, `antigravity` enabled — mọi thứ khác đều đúng; chỉ mỗi switch của claude_code chặn | `codeg.db` |

Blast radius: **mọi session `claude_code` từ ~Oct 7 đều không delegate được** (log ghi 27+26+21+4 lần withhold trong 4 ngày). Session 720 hiện tại cũng đang bị withhold.

## 4. Fix

**A. Ngay lập tức (khôi phục delegation):**
1. Settings → Agents → Claude Code → tắt switch "Let the agent handle files and commands" (xóa `CODEG_ACP_HOST_TOOLS=agent` khỏi env).
2. Mở **session mới** — verdict là launch-time, connection cũ giữ nguyên trạng thái cũ.

**B. Nếu cần giữ switch ON (cho OS sandbox của claude):** delegation cho agent đó bị tắt **theo thiết kế**; không có cách vừa giữ switch vừa delegate từ chính session claude. Phải assign từ session của agent khác không bật switch.

## 5. UX gap (tùy chọn, product decision)

- Composer `@` panel chỉ filter `agent.enabled` (`src/components/chat/composer/use-reference-search.ts:121`) — không biết connection hiện tại đã bị withhold delegation. User mention agent → không có cảnh báo nào ở composer, chỉ có cảnh báo trong trang Settings → Delegation (`withheldByHostTools`) và log.
- Cân nhắc: khi parent agent có `host_tools_agent_mode = true`, hiện cảnh báo (hoặc chặn reference agent) ngay tại composer.

## 6. Câu hỏi chưa giải quyết

- Ai/khi nào bật switch? `agent_setting.updated_at` = Oct 8 07:16Z nhưng log đã withhold từ Oct 7 06:36Z — không có audit trail chính xác.
- Có muốn patch UX composer (cảnh báo khi mention trong session bị withhold delegation) không?
