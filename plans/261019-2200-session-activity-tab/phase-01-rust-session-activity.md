# Phase 1 — Rust: SessionActivity model + claude parser

## Overview

Priority: P1. Status: Complete (100%).

Thêm `SessionActivity` (skills + settled background tasks) vào `ConversationDetail`, parse trong claude parser. Session cũ mở lại cũng thấy — dữ liệu là hàm thuần của transcript bytes.

## Context

- Brainstorm: `plans/reports/brainstorm-session-activity-view.md`
- `ConversationDetail` (`src-tauri/src/models/conversation.rs:130`) đã có `session_stats: Option<SessionStats>` — pattern `skip_serializing_if` theo đó.
- `BackgroundNotification` (`parsers/claude.rs:53`) + accumulator field `background_notifications` (`claude.rs:1819`) — state machine task-notification ĐÃ CÓ. Không viết mới, chỉ expose.
- Claude parser entry: `parse_conversation_detail(&self, path, conversation_id)` (`claude.rs:2856`).
- Skill tool: tool_use `name == "Skill"`, input `{skill?, name?, command?…}` — claude CLI hiện dùng field `skill` (verify trong phase này bằng transcript thật; fallback đọc cả `name`).

## Requirements

1. Model `SessionActivity` (`src-tauri/src/models/conversation.rs` hoặc file mới `models/session_activity.rs` — nếu >200 tách file):
   ```rust
   pub struct SessionActivity {
       pub skills: Vec<SkillUse>,          // gom theo tên
       pub background_tasks: Vec<BackgroundTaskInfo>, // settled only
   }
   pub struct SkillUse {
       pub name: String,
       pub call_count: u32,
       pub last_used_at: Option<DateTime<Utc>>,
   }
   pub struct BackgroundTaskInfo {
       pub task_id: String,
       pub name: String,             // từ launch marker/notification
       pub task_type: String,        // shell | workflow | monitor
       pub state: String,            // completed | failed | stopped
       pub last_tool_name: Option<String>,
       pub output_file_path: Option<String>,
   }
   ```
   Serialize snake_case mặc định (serde đổi rồi trong app).
2. Parser gom trong `parse_conversation_detail`:
   - Skill: scan tool_use blocks đã build (accumulator đã giữ) — đếm theo tên, ghi `last_used_at` từ timestamp record.
   - Background settled: từ `background_notifications` map sau finalize — task có notification kết thúc (completed/failed/stopped). Task đang chạy KHÔNG đưa vào (live do frontend `liveAsyncTasks` phụ trách — tránh double-source).
3. `ConversationDetail.session_activity: Option<SessionActivity>` + `#[serde(skip_serializing_if = "Option::is_none")]`. Chỉ claude parser set `Some`; các parser khác để `None`.
4. `summary_cache` KHÔNG đụng — activity chỉ nằm ở detail, không nằm ở summary.

## Implementation Steps

1. Đọc kỹ `ClaudeRecordAccumulator` finalize path + `BackgroundNotification` fields thật (state cuối có đủ `completed|failed|stopped` chưa — nếu thiếu thì bổ sung state machine, đừng infer).
2. Thêm model structs + serde derives.
3. Gom skills + settled tasks trong `parse_conversation_detail` trước khi return `ConversationDetail`.
4. Unit tests inline `#[cfg(test)]` module `claude.rs` (pattern sẵn có: `parse_detail_sets_claude_context_window_stats` @5762):
   - fixture JSONL mini: 2 Skill call (cùng tên ×2 + khác tên ×1) → counts + last_used_at đúng.
   - fixture: bg bash launch + task-notification completed/failed → đúng state; không có notification → không có row.
   - parser khác (opencode fixture có sẵn) → `session_activity == None`.
5. `cargo check --all-targets` + `cargo clippy --all-targets --features test-utils -- -D warnings`.

## Related Files

- `src-tauri/src/models/conversation.rs` — modify (hoặc models/session_activity.rs mới)
- `src-tauri/src/parsers/claude.rs` — modify
- `src-tauri/src/models/mod.rs` — modify (re-export nếu file mới)

## Success Criteria

- Unit tests pass; `session_activity` xuất JSON đúng shape TS side sẽ mirror (phase 2).
- Parsers khác trả None (test với opencode fixture).

## Risks

- `BackgroundNotification` thiếu state cuối → phải mở rộng; scope tăng. Mitigation: verify trước khi code (step 1).
- Skill input field name khác giữa CLI versions → đọc cả `skill`/`name`, prefer `skill`.

## Next

Phase 2 mirror types + insights store.

## Completion (2026-10-20) — DONE

- [x] Step 1: `BackgroundNotification` state machine verified đủ — reused, không mở rộng.
- [x] Step 2: Model structs + serde derives added (`models/conversation.rs`; re-export `models/mod.rs`).
- [x] Step 3: Skills + settled bg tasks gom trong claude `parse_conversation_detail`; parsers khác để None.
- [x] Step 4: Rust unit tests — skill tally (cùng tên ×N + khác tên), settled bg state, other-parser-None. 113 claude parser tests pass.
- [x] Step 5: `cargo check --all-targets --features test-utils` 0 errors; clippy `-D warnings` clean.
