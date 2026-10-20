# Phase 2 — Frontend: types mirror + insights store parts

## Overview

Priority: P1. Status: Complete (100%).

Mirror `SessionActivity` sang TS, mở rộng `TranscriptInsights` với 2 parts mới (activity settled + files cumulative) và wire publish từ `message-list-view`.

## Context

- TS mirror: `src/lib/types.ts` — pattern `AsyncTaskRecord` mirror Rust (`types.ts:3617`).
- Insights store: `src/stores/transcript-insights-store.ts` — `TranscriptInsights` hiện có `nav` + `plan` parts; `mergeTranscriptInsights` giữ part không đổi (re-render tối ưu sẵn).
- Publish site: `message-list-view.tsx:1917` `publishTranscriptInsights(conversationId, owner, insights)`; memo deps hiện list `navEntries, sidebarPlanEntries…`.
- Demand pattern: `demandTranscriptNav(conversationId)` — section đăng ký nhu cầu rồi mới tính.

## Requirements

1. `types.ts` thêm mirror:
   ```ts
   export interface SessionActivity {
     skills: SessionSkillUse[]
     background_tasks: SessionBackgroundTaskInfo[]
   }
   export interface SessionSkillUse { name: string; call_count: number; last_used_at?: string | null }
   export interface SessionBackgroundTaskInfo {
     task_id: string; name: string; task_type: string; state: string
     last_tool_name?: string | null; output_file_path?: string | null
   }
   ```
2. `ConversationDetail` type (types.ts, tìm chỗ `session_stats`) += `session_activity?: SessionActivity` (optional — None không serialize).
3. `transcript-insights-store.ts`:
   ```ts
   export interface TranscriptActivityInsights {
     /** Settled background tasks từ Rust detail. */
     backgroundTasks: readonly SessionBackgroundTaskInfo[]
     /** Skills gom theo tên. */
     skills: readonly SessionSkillUse[]
     /** Cumulative files từ extractSessionFiles(turns). */
     files: readonly SessionFileChange[]
   }
   ```
   `TranscriptInsights` += `activity: TranscriptActivityInsights | null`.
4. `message-list-view.tsx` publish:
   - activity chỉ tính khi `insightsInSidebar`; files dùng `extractSessionFiles(sourceTurns)` memo theo turns.
   - `session_activity` đọc từ detail đã có trong runtime store (không fetch mới).
   - Không tính khi tab không mở → dùng `demandTranscriptNav` pattern: thêm `demandTranscriptActivity` + hook `useTranscriptActivityDemanded` mirror nav demand (mở `transcript-insights-store.ts:337` làm mẫu).

## Implementation Steps

1. types.ts mirror + chạy `pnpm lint .` kiểm strict.
2. Store parts + demand hook (mirror nav demand chính xác — đọc `demandTranscriptNav` trước khi viết).
3. Publish site mở rộng memo; giữ reference-stable (EMPTY arrays module-level như `EMPTY_TURNS` pattern `aux-panel-session-details-tab.tsx:19`).
4. Unit test store: publish part mới không wake reader part cũ (mirror `transcript-insights-store.test.ts` có sẵn).

## Related Files

- `src/lib/types.ts` — modify
- `src/stores/transcript-insights-store.ts` — modify
- `src/components/message/message-list-view.tsx` — modify (publish memo)
- `src/stores/transcript-insights-store.test.ts` — modify

## Success Criteria

- `pnpm lint .` + `pnpm test` pass; store test chứng minh part-isolation.

## Risks

- Memo activity re-tính mỗi streaming batch → chỉ publish khi `insightsInSidebar` + demand; files memo theo turns reference.

## Next

Phase 3 UI tab.

## Completion (2026-10-20) — DONE

- [x] Step 1: types.ts mirror (`SessionActivity`, `SessionSkillUse`, `SessionBackgroundTaskInfo`, `session_activity?` trên `ConversationDetail`) — `pnpm lint` strict pass.
- [x] Step 2: Store parts + `demandTranscriptActivity` demand hook (mirror nav demand) trong `transcript-insights-store.ts`.
- [x] Step 3: Publish memo mở rộng trong `message-list-view.tsx`, chỉ khi insights demanded.
- [x] Step 4: Store unit tests — part-isolation giữ nguyên behavior. Store tests 18 pass.
