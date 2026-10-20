---
title: "Session Activity Tab"
description: "Tab Activity mới trong aux panel: Live, Subagents (Agent + delegate_to_agent), Background Tasks (live + settled), Files Changes (cumulative + diff), Skills Used"
status: complete (100%)
priority: P2
effort: 12h
branch: feat/mcp-board-read-tools
tags: [feature, frontend, backend]
created: 2026-10-19
---

# Session Activity Tab

## Overview

Thêm tab **Activity** vào aux panel, đặt ngay sau `session_details` trong `AUX_PANEL_TABS`, gồm 5 section: Live (subagent + bg task đang chạy gộp), Subagents (settled — native `Agent` + `delegate_to_agent`), Background Tasks (settled từ Rust), Files Changes (cumulative + diff inline lazy), Skills Used (từ Rust). Dữ liệu skill + settled bg task trích ở tầng Rust parser (`SessionActivity` trên `ConversationDetail`), session cũ mở lại vẫn thấy. Subagents/files/skills tái dùng hoàn toàn hạ tầng có sẵn.

Brainstorm report: `plans/reports/brainstorm-session-activity-view.md`.

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Rust: `SessionActivity` model + claude parser (skills, settled bg tasks) | Complete | 4h | [phase-01](./phase-01-rust-session-activity.md) |
| 2 | Frontend: types mirror + insights store parts | Complete | 2h | [phase-02-types-and-insights.md](./phase-02-types-and-insights.md) |
| 3 | Tab Activity: tab registration + 5 section UI | Complete | 5h | [phase-03-activity-tab-ui.md](./phase-03-activity-tab-ui.md) |
| 4 | Diff lazy + tests | Complete | 1h | [phase-04-tests.md](./phase-04-tests.md) |

## Key Decisions (brainstorm chốt)

- Tab Activity ngay sau `session_details`; Session Details giữ nguyên.
- Thứ tự section: Live → Subagents → Background Tasks → Files Changes → Skills Used. Section rỗng → không render.
- Subagents gộp 2 nguồn: native `Agent` (drawer transcript con) + `delegate_to_agent` (mở conversation con). Phân biệt bằng icon agent (native = agent hiện tại, delegation = `AgentIcon` + tên agent đích qua `getAgentLabel`). Không tag chữ.
- Row format: `<status> <loại>: <nội dung> · <thời lượng>` — native: `subagent_type` label + `input.description`; delegation: agent đích + `input.task`. Duration: native từ transcript con `started_at`; delegation từ child `created_at → updated_at`; thiếu → ẩn.
- Files: chỉ cumulative flat + diff inline lazy khi bấm (per-message đã có trong nav entries — không làm lại).
- Parse skill + settled bg task ở Rust (session cũ thấy; không phụ thuộc `input_preview`).
- `ConversationDetail.session_activity: Option<SessionActivity>`, `skip_serializing_if` — parsers khác None → sections 3/5 ẩn.

## Data Sources (đã verify)

- Subagents: `navEntries.subAgentsByUserTurnId` (`message-nav-entries.ts`); delegation: `DelegationCardSource` (`use-delegation-card-model.ts:41`) + `isDelegateToAgentToolName` (`lib/delegation-card.ts:818`) + `DelegationIdentity`.
- Live bg: `liveAsyncTasks` (`lib/async-tasks.ts`), `AsyncTaskRecord.state` (`types.ts:3617`).
- Settled bg: `BackgroundNotification` (`parsers/claude.rs:53`) — đã có state machine trong accumulator.
- Skills: tool_use `name == "Skill"` (claude transcript; OpenCode native `skill` tool `{name}` — follow sau nếu cần).
- Files: `extractSessionFiles` (`lib/session-files.ts:1157`), diff `buildSessionFileDiff` (lazy).
- Insights publish: `publishTranscriptInsights` (`message-list-view.tsx:1917`), store `transcript-insights-store.ts`; demand pattern `demandTranscriptNav`.

## Constraints

- Static export Next.js — không dynamic route.
- TypeScript strict; Rust 2021 + thiserror; Prettier no-semicolon 2-space.
- Insights chỉ tính khi panel mở; diff chỉ build khi bấm.
- i18n 10 ngôn ngữ — thêm key mới vào đủ 10 message files.

## Success Criteria

- Tab Activity sau session_details, đủ 5 section cho session Claude (cũ + mới); Session Details không đổi.
- Subagent section gồm cả native Agent (drawer) lẫn delegate_to_agent (mở conversation con); icon phân biệt đúng.
- Settled bg task hiện đúng state sau reload app.
- File bấm mở diff; số file khớp tổng các message.
- `cargo check --all-targets` + `cargo clippy -D warnings` + `pnpm lint` + `pnpm test` pass.

## Unresolved Questions

- (none blocking — OpenCode `skill` tool defer; verify `BackgroundNotification` đủ state cuối khi implement phase 1)

## Completion (2026-10-20)

- 4/4 phases Complete. Tester + code-reviewer reports: `plans/reports/tester-activity-tab.md`, `plans/reports/code-reviewer-activity-tab.md`.
- Review fix applied: Stop button gated by `task.can_stop` (`aux-panel-activity-tab.tsx`).
- Verification: `pnpm lint` 0 errors; `pnpm test` 10111/10111 pass; `cargo check --all-targets --features test-utils` 0 errors; clippy clean; 113 claude parser tests pass.
- Docs impact: evaluated 2026-10-20. Không có `docs/` nào mô tả aux panel tabs (`codebase-summary.md`, `system-architecture.md`, changelog/roadmap không tồn tại trong repo); README feature list không liệt kê từng tab → không cần sửa. Chi tiết feature nằm trong plan này.
