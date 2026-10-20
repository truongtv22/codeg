# Phase 3 — Tab Activity: registration + 5 section UI

## Overview

Priority: P1. Status: Complete (100%).

Đăng ký tab `activity` ngay sau `session_details` trong aux panel + dựng 5 section theo wireframe đã chốt (xem plan.md / brainstorm report).

## Context

- Tab infra: `AUX_PANEL_TABS` (`src/lib/aux-panel-tab-order.ts`) — mảng const; thêm `"activity"` sau `"session_details"`. Permutation logic (`normalizeAuxTabOrder`) tự thích ứng — đọc test hiện có trước.
- Tab body: `aux-panel.tsx:35` imports từng tab component; thêm `ActivityTab` theo cùng pattern. LAZY_TABS list (`aux-panel.tsx:43`) — thêm activity vào lazy.
- Rail icon: `aux-panel-tab-rail.tsx` icon map — thêm icon (lucide `Activity` — đã dùng trong async-task-strip).
- Section component: `InsightsSection` (`layout/session-details-insights.tsx`) — chevron + title + summary + fold state + `useSessionDetailsSectionOpen` prefs. TÁI DỤNG (export nó nếu chưa, đừng copy).
- Subagent rows: `DelegationCardSource` → model `use-delegation-card-model.ts` (status, identity, childConversationId); native rows: `subAgentsByUserTurnId` flatten — entry đã có status + child transcript id; drawer host `SessionViewerHost` + `SubagentSessionDialog`.
- Live bg rows: `liveAsyncTasks` (`lib/async-tasks.ts`) + stop action như `async-task-strip.tsx` (tái use `useWorkspaceActions`/stop request path — đọc strip trước).
- Row icons: `StatusBadge` (delegation-status-badge.tsx), `TASK_ICONS` (async-task-strip.tsx:52), `AgentIcon` (components/agent-icon.tsx).
- Files rows: `extractSessionFiles` (`lib/session-files.ts:1157`) + `toFolderRelativePath`/`fileNameOf` (`lib/file-path-display.ts`) + mở qua `useOpenFileTarget`; diff = phase 4.
- i18n: `src/i18n/messages/*.json` 10 files — namespace `Folder.sessionDetails` mở rộng hoặc `Folder.activity` mới. Dùng `Folder.activity`.

## Requirements (wireframe chốt)

```
Activity tab (scroll): 5 InsightsSection, mỗi section rỗng → không render.
1. Live — subagent running + bg task running gộp; bg row có nút stop (nếu can_stop).
2. Subagents — settled + running cả hai (Live là view gộp, không loại bỏ khỏi đây);
   row: <StatusIcon> <AgentIcon|agent-label>: <description|task> · <duration>
   native: label = subagent_type qua getAgentLabel; bấm → drawer transcript con.
   delegation: icon + tên agent đích (DelegationIdentity); bấm → mở conversation con.
   duration: thiếu → ẩn.
3. Background Tasks — settled từ insights activity.backgroundTasks; row: task icon + name + state + [↗ output] nếu có output_file_path.
4. Files Changes — cumulative list: chip [A/M/R] + path relative + bấm mở file; removed → static destructive (pattern reply-artifacts.tsx).
5. Skills Used — row: tên + ×call_count + lần cuối (last_used_at format relative).
```

## Implementation Steps

1. `aux-panel-tab-order.ts`: thêm `"activity"`; đọc + update test permutation nếu cần.
2. `aux-panel.tsx`: import lazy `ActivityTab`, thêm tab value + `TabsContent`; `aux-panel-tab-rail.tsx` icon.
3. i18n 10 message files: `Folder.activity.*` (section titles, states, buttons — mirror key style `Folder.chat.delegation`).
4. `components/layout/aux-panel-activity-tab.tsx`: skeleton — `conversationId` từ aux panel context (pattern `aux-panel-session-details-tab.tsx`), demand hook phase 2, ScrollArea.
5. 5 section components trong cùng file hoặc tách `aux-panel-activity-sections.tsx` nếu >200 dòng:
   - Subagents: flatten `subAgentsByUserTurnId` từ `useTranscriptNavPart` (đã demand bởi tab) + delegation sources từ nav entries; group đã có — chỉ flat + sort (running trước, rồi theo thời gian).
   - Live: reuse delegation card model cho subagent running + `liveAsyncTasks` cho bg.
   - Files: `extractSessionFiles(turns)` — turns lấy từ runtime store slice như session-details-tab làm.
   - Skills/Bg settled: từ `useTranscriptActivityPart` (phase 2).
6. Vitest: tab render rỗng (không section nào), render có data fixture (mirror `aux-panel-*` test style), demand hook được gọi khi active.

## Related Files

- `src/lib/aux-panel-tab-order.ts` — modify
- `src/components/layout/aux-panel.tsx` — modify
- `src/components/layout/aux-panel-tab-rail.tsx` — modify
- `src/components/layout/aux-panel-activity-tab.tsx` — create
- `src/i18n/messages/*.json` (10) — modify
- tests — create

## Success Criteria

- Tab hiện sau session_details; đủ 5 section theo wireframe; section rỗng ẩn.
- Bấm native subagent row → drawer transcript con; bấm delegation row → conversation con mở.
- i18n đủ 10 ngôn ngữ (không key thiếu — check script/test i18n có sẵn).
- `pnpm lint .` + `pnpm test` pass.

## Risks

- Tab order persistence cũ (user đã lưu permutation) → normalize phải tự chèn activity đúng vị trí; test với stored array thiếu activity.
- 200-line rule → tách section file sớm.
- liveAsyncTasks theo conversation runtime — đảm bảo demand đúng conversationId (runtimeConversationId ?? conversationId pattern).

## Next

Phase 4 diff lazy + tests.

## Completion (2026-10-20) — DONE

- [x] Step 1: `"activity"` đăng ký sau `session_details` trong `aux-panel-tab-order.ts`; tab-order tests 18 pass (permutation thích ứng).
- [x] Step 2: `aux-panel.tsx` lazy tab + `aux-panel-tab-rail.tsx` icon.
- [x] Step 3: i18n `Folder.activity.*` đủ 10 message files (verify grep `"activity"` = 10/10).
- [x] Step 4: `aux-panel-activity-tab.tsx` skeleton + demand hook + ScrollArea.
- [x] Step 5: 5 sections tách `aux-panel-activity-sections.tsx` + `aux-panel-activity-files-section.tsx` (≤200 dòng/file). Live stop button gated by `task.can_stop` (review fix).
- [x] Step 6: Vitest — `aux-panel-activity-tab.test.tsx` (3 tests) + `aux-panel-activity-files-section.test.tsx` (4 tests) + `aux-panel.test.tsx` (25) pass.
