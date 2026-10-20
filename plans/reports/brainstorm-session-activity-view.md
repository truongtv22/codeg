# Brainstorm: Session Activity View (subagents / files / background tasks / skills)

Ngày: 2026-10-19. Nhánh: `feat/mcp-board-read-tools`.

## Vấn đề

Cần 1 chỗ xem tổng hợp cho 1 conversation:

1. Subagents (running / completed / failed) + xem transcript như conversation
2. Files changed từ đầu session tới hiện tại
3. Background tasks (gồm cả đã kết thúc)
4. Skills used

## Hiện trạng (scout)

| Mục | Trạng thái | Vị trí |
|---|---|---|
| Subagents | ✅ có sẵn (2 nguồn) | Native `Agent` tool: nav entries `subAgentsByUserTurnId` + drawer transcript con (`sub-agent-overlay.tsx`, `session-viewer-host.tsx`); Rust: `attribute_subagent_usage` (`parsers/claude.rs:3498`). Delegation `delegate_to_agent` (cross-agent, tạo conversation con kind=`delegate`): `DelegationCardSource` + `isDelegateToAgentToolName` (`lib/delegation-card.ts:818`), bind con qua meta `codeg.delegation` |
| Files changed | ⚠️ một phần | Per-message trong nav entries; tab "Changes" là git working-tree (lẫn thay đổi ngoài conversation). Lib sẵn: `extractSessionFiles`, `extractSessionFilesGrouped`, `buildSessionFileDiff` (`lib/session-files.ts`) |
| Background tasks | ⚠️ một phần | `AsyncTaskStrip` (`chat/async-task-strip.tsx`) chỉ render task sống (`liveAsyncTasks`); settled biến mất ngay. Rust đã có `BackgroundNotification` + marker `[[codeg-background-task]]` trong `claude.rs` |
| Skills used | ❌ chưa có | Chỉ card "Skill: x" inline trong `content-parts-renderer.tsx:1150` |

## Quyết định (user chốt)

- **UI**: tab **Activity** mới trong aux panel, đặt **ngay sau session_details** trong `AUX_PANEL_TABS`. Session Details giữ nguyên (Card + Plan + Message nav).
- **Thứ tự section trong tab**: 1. Live (subagent + bg task đang chạy, gộp) → 2. Subagents (settled) → 3. Background Tasks (settled) → 4. Files Changes → 5. Skills Used.
- **Files**: chỉ cumulative flat + diff inline khi bấm (per-message đã có sẵn trong nav entries — không làm lại).
- **Background**: gồm cả settled (completed/failed/stopped), trích từ transcript.
- **Tầng parse**: Rust backend (session cũ mở lại vẫn thấy; không phụ thuộc `input_preview`).
- **Phạm vi**: làm trọn cả 4 mục.

## Phương án đã cân nhắc

1. **Tab Activity mới, đặt sau session_details** ✅ chọn — activity tách hẳn khỏi Session Details; có mục Live gộp (subagent + bg task đang chạy) nhìn 1 chỗ. Chi phí: đụng `AUX_PANEL_TABS` + tab order permutation + i18n 10 ngôn ngữ + rail icon, rail 8 → 9 tabs.
2. Mở rộng Session Details — 0 đụng tab infra nhưng trộn activity vào tab đã đông (Card + Plan + nav).
3. Overlay riêng trên transcript — trùng lặp chức năng, bỏ.

## Kiến trúc chốt

```
Rust parser (claude.rs)                     Frontend (tab Activity, aux panel)
┌───────────────────────────┐               ┌──────────────────────────────┐
│ SessionActivity (mới)     │ Conversation- │ InsightsSection × 5:          │
│ ├ skills: Vec<SkillUse>   │ Detail JSON   │ 1. Live (subagent + bg đang  │
│ ├ bg_tasks: Vec<BgTaskInfo│ ────────────▶ │    chạy, từ liveAsyncTasks)   │
│ │  (từ BackgroundNotifi-  │               │ 2. Subagents (settled; Agent │
│    + delegate_to_agent)      │
│ │   cation đã có)         │               │ 3. Background (settled)      │
│ └ cache vào summary_cache │               │ 4. Files (cumulative + diff  │
│                           │               │    + diff inline lazy)       │
│                           │               │ 5. Skills used               │
└───────────────────────────┘               └──────────────────────────────┘
```

- `ConversationDetail` += `session_activity: Option<SessionActivity>` (`skip_serializing_if` — parsers khác trả None → frontend ẩn section).
- **Subagents section gộp 2 nguồn**: (1) native `Agent` tool — flatten `subAgentsByUserTurnId`, bấm mở drawer transcript con; (2) `delegate_to_agent` — từ `DelegationCardSource`/delegation meta, bấm mở conversation con như 1 conversation thật. Cả hai đã có sẵn dữ liệu, section chỉ flatten gộp list.
- **Phân biệt 2 nguồn bằng icon agent** (`AgentIcon` + màu `getAgentColor`): native subagent = icon agent hiện tại, delegation = icon + tên agent đích ("Codex", `getAgentLabel` — có sẵn trong `agent-capsule.tsx`). Không tag chữ.
- **Row format**: `<trạng thái> <loại>: <nội dung> · <thời lượng>` — native: `subagent_type` label (getAgentLabel) + `input.description`; delegation: tên agent đích + `input.task` (truncate 1 dòng). Thời lượng: native từ transcript con (`started_at`), delegation từ child conversation `created_at → updated_at`; thiếu → ẩn.
- Live bg tasks tiếp tục từ `liveAsyncTasks` (AsyncTaskRecord: state running/paused/completed/failed/stopped, can_stop).
- Insights publish qua `transcript-insights-store` (pattern `publishTranscriptInsights` ở `message-list-view.tsx:1917`); chỉ tính khi panel mở (`demandTranscriptNav` pattern).
- Diff inline: lazy per-file qua `buildSessionFileDiff`, không precompute toàn session.

## Rủi ro & cắt giảm

| Rủi ro | Xử lý |
|---|---|
| Session dài → re-parse nặng | Insights chỉ tính khi panel mở |
| Diff tốn I/O | Lazy khi bấm file |
| Parsers khác (codex…) | `None` → ẩn section |
| Settled tasks biến mất khỏi strip | Strip giữ nguyên; lịch sử ở panel từ Rust |

**Cắt:** không skill tracker frontend, không re-parse transcript ở React cho skill/bg-task, không overlay mới. Tab Activity là tab mới DUY NHẤT được thêm.

## Chỉ số thành công

- Tab Activity (sau session_details) thấy đủ 5 section cho session Claude bất kỳ (cũ + mới); Session Details giữ nguyên.
- Subagent section gồm cả native Agent (drawer transcript con) lẫn delegate_to_agent (mở conversation con); status đúng running/ok/err cho cả hai.
- File bấm mở diff; cumulative list khớp số file của tổng các message.
- Settled background task hiện với state đúng sau reload app.

## Bước tiếp theo

1. `/ck:plan` với ngữ cảnh báo cáo này → `plans/` phase files.
2. Phase gợi ý: (a) Rust `SessionActivity` + claude parser + snapshot tests; (b) types.ts mirror + insights store parts; (c) tab Activity mới (tab order, i18n, rail) + 5 section UI; (d) diff lazy + tests vitest.

## Câu hỏi chưa rõ

- Skill tool tên hiển thị ở các agent khác (codex/opencode có tool skill riêng?) — hiện chỉ làm cho Claude parser; parsers khác follow sau nếu cần.
- "Failed" background task từ transcript cũ: `BackgroundNotification` có đủ thông tin state cuối chưa — cần verify trong phase Rust.
