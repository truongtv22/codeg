# Code Review — Session Activity Tab (feat/mcp-board-read-tools)

Reviewer: code-reviewer subagent. Review only, no files modified.
Scope: uncommitted changes on `feat/mcp-board-read-tools` — Rust `SessionActivity` model + parser wiring, insights store activity part, 3 new components, aux-panel tab wiring, i18n (10 locales), tests.

## Verdict

**No critical issues. One major. Rest minor.**

The demand/release pattern is a faithful copy of the proven `demandTranscriptNav` pattern (ref-counted, double-release guarded, map replaced immutably — verified `activityDemand` mirrors `navDemand` at `src/stores/transcript-insights-store.ts:451-477` vs `:419-435`). Part-isolation merge keeps object identity stable for unchanged parts (`mergeActivity`, `:327-357`). Rust vocabulary and TS `TASK_STATE_KEYS` are in exact sync (9 entries, verified identical). Rust side is well tested (first-use ordering, launch-ack/notification join, zombie-"running" trap, interim filtering — `parsers/claude.rs:9512-9596`). i18n key parity verified across all 10 locales (23 keys each). Diff rendering is XSS-safe (`CompactDiff` has no `dangerouslySetInnerHTML`; paths render as React text). `cargo check` compiles clean on lib/bin targets; frontend: 89 tests across 7 affected files pass.

## MAJOR

### M1. Stop button ignores `can_stop`
- `src/components/layout/aux-panel-activity-tab.tsx:99-106` — `handleStopTask` is provided for every live task whenever the connection is not a viewer.
- `src/components/layout/aux-panel-activity-sections.tsx:104-112` — renders Stop whenever `task.onStop` is set.
- The pattern this file says it mirrors gates differently: `src/components/chat/async-task-strip.tsx:172` — `{task.can_stop && onStop && ...}`. `AsyncTaskRecord.can_stop` defaults to `false` (`src/lib/async-tasks.ts:53`).

Result: a live task with `can_stop === false` (the default for anything whose `spawned` delta omitted it) gets a Stop button whose `acp_stop_async_task` call the adapter declines — and the tab discards the boolean (`void acpStopAsyncTask(...)`), so the row just sits there. Fix: carry `can_stop` into the mapped row and gate `onStop` on it, e.g. `onStop: task.can_stop ? handleStopTask : undefined`.

## MINOR

### 1. TS mirror type lies about serde omission
`src/lib/types.ts` — `SessionActivity.skills` / `background_tasks` are declared required, but Rust marks both `#[serde(skip_serializing_if = "Vec::is_empty")]` (`models/conversation.rs:133,140`). When only one is non-empty the other is absent from the JSON. Saved today only because the single consumption site does `parsedActivity?.background_tasks ?? []` (`message-list-view.tsx:1998-1999`). Mark both `?:` for strict-mode accuracy.

### 2. Unknown task state renders as "completed"
`aux-panel-activity-sections.tsx:179-183` — `taskStateKey` falls back to `"completed"` for any state outside the 9-key list, while `BackgroundTaskStateIcon` (`:26`) treats the same unknown as failed (destructive icon). Net: destructive spinner-glyph + "completed" label. Unreachable today (Rust filters to the same vocabulary), but the two fallbacks disagree — if the vocabularies ever drift, the UI shows a contradiction. Fall back consistently (or surface the raw string).

### 3. Loader2 glyph for settled failure
`aux-panel-activity-sections.tsx:19-38` — a failed/stopped/killed background task renders `Loader2` (a spinner shape, without `animate-spin`). A loader glyph on a settled task reads as "in progress". Same for live paused tasks: `LiveTaskIcon` (`:42-50`) spins for `paused`, while the strip shows `PauseCircle` (`async-task-strip.tsx:139-144`). Cosmetic, but inconsistent with the affordance this tab claims to mirror.

### 4. `mergeFileChangesFlat` has no test
`src/components/message/message-list-view.tsx:456-510` — cumulative sums, same-path merging, and the `"\n\n"` diff join (the text `CompactDiff` parses) are untested; the Rust tallies got dedicated tests, the TS aggregation did not. One small table-driven test would pin the join separator and the first-occurrence-order contract.

### 5. Perf note: activity files computed per streaming batch while tab merely visible
`message-list-view.tsx:1889-1900` — `activityFiles` recomputes on every `timelineTurns` change whenever the Activity tab is open, even with the Files section folded. The navigator gates harder (`active && open && count > 0`, `session-details-insights.tsx:270-275`). Same O(all turns diff parse) cost class as nav, so acceptable — but folding the Files section buys nothing today.

### 6. Fire-and-forget stop with no feedback
`aux-panel-activity-tab.tsx:103` — `void acpStopAsyncTask(...)`; the strip tracks a `stopping` state and re-enables deliberately (`async-task-strip.tsx:106-118`). Not wrong, just less considered; M1's fix subsumes most of it.

### 7. Dead re-export
`aux-panel-activity-tab.tsx:153-155` — `export type { ConnectionState }` with a "reference keep" comment. Nothing imports it. Delete.

### 8. File-length guidance
`aux-panel-activity-sections.tsx` (228) and `aux-panel-activity-files-section.tsx` (215) exceed the 200-line rule; both are cohesive single-concern modules, so I would not split — noting for the record.

### 9. `skill_name_from_input` accepts `"command"`
`parsers/claude.rs:96-106` — falls through to `input["command"]`; if a future tool also named `Skill` carried a shell command there, it would be tallied as a skill name. Gated by exact-name match on `Skill`, so exposure is theoretical.

## Verified-correct (spot checks)

- `session_activity` threaded on all three return paths of `get_folder_conversation_core` (`commands/conversations.rs:1472,1514`, and `None` in the ConversationNotFound fallback and `windowless_detail`).
- Rust/TS terminal-state vocabularies identical; Rust filters non-terminal + interim notifications out (`parsers/claude.rs:2980-2988`), matching the zombie-trap doc.
- Demand effect deps `[active, runtimeId]` correct; cleanup releases on tab switch/unmount; no stale-closure path found. `useSyncExternalStore` snapshot is the connection object replaced immutably on every reducer action (`acp-connections-context.tsx:3067-3075`), with `notifyKeyListeners` fired on the same actions — no missed renders.
- `mergeKeyedList`/`mergePositionalList` reuse (no new merge machinery), `EMPTY_*` stable references prevent churn.
- Tab-order tests updated consistently, including the REVERSED-case comment explaining why `activity` is pinned after `session_details`.
- Integration-test compile failures in `cargo check --all-targets` (`ws_attach`/`api_integration`/`delegation_columns`: `db::test_helpers` needs `--features test-utils`) are pre-existing and unrelated to this change.

## Unresolved questions

- M1: confirm intended behavior — should `can_stop` gate the Stop affordance here like the strip, or is the tab deliberately offering stop for everything stoppable-server-side?
- Minor 2: preferred fallback for an unknown settled state — neutral label (raw string) or keep silent-completed?
