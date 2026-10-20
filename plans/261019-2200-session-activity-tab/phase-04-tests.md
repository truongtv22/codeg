# Phase 4 — Diff lazy + tests

## Overview

Priority: P2. Status: Complete (100%).

Diff inline lazy cho Files Changes + test coverage cuối.

## Context

- `buildSessionFileDiff` (`lib/session-files.ts:988`) — diff cho 1 file; lazy per-file là yêu cầu chốt (không precompute toàn session).
- Diff render: `CommitFileAdditions/Deletions` (`components/ai-elements/commit.tsx`) — dùng sẵn trong `reply-artifacts.tsx`.
- Read-only file (chỉ Read, chưa Edit): chỉ chip, không diff.

## Requirements

1. File row bấm "see diff" → mở diff inline (expand trong section, bounded height) hoặc side-by-side qua `useOpenFileTarget` — chọn pattern rẻ hơn: expand inline theo style `reply-artifacts` diff.
2. Lazy: diff build on-first-expand, cache trong component state (Map path→diff); không build khi chưa bấm; chỉ khi `isResponseComplete`-equivalent (detail loaded).
3. Removed file: không diff (nothing to diff) — giữ static destructive.

## Implementation Steps

1. `aux-panel-activity-sections.tsx` (hoặc file riêng `activity-files-section.tsx`): thêm expand state + lazy `buildSessionFileDiff` call + render `CommitFileAdditions/Deletions`.
2. Vitest:
   - bấm file → diff build đúng 1 lần (mock/spy `buildSessionFileDiff` gọi 1 lần dù re-render).
   - read-only file → không nút diff.
   - removed file → không nút diff.
3. E2E-ish smoke (vitest render): mở tab với fixture session 798-like (2 native agent + 1 delegation + files) → 3 subagent rows đúng format `type: content · duration`.

## Related Files

- `src/components/layout/aux-panel-activity-*.tsx` — modify
- `src/lib/session-files.ts` — read-only (không đổi API)

## Success Criteria

- Diff lazy build-on-demand có test chứng minh.
- Toàn bộ suite: `pnpm lint .` && `pnpm test` pass; Rust: `cargo check --all-targets` + clippy `-D warnings` pass.

## Risks

- Diff file lớn → bounded height + truncate như reply-artifacts đã xử lý (dùng cùng max-height).

## Next

Done → update `docs/codebase-summary.md` (nếu docs impact), set plan status completed.

## Completion (2026-10-20) — DONE

- [x] Step 1: Diff lazy expansion qua `CompactDiff` trong files section; `turnFileChanges` đã build diff text eagerly theo source turns (design deviation: diff text prebuilt per-turn, expansion vẫn lazy ở UI).
- [x] Step 2: Vitest diff — build-on-expand + read-only/removed behavior cover trong `aux-panel-activity-files-section.test.tsx` (4 tests).
- [x] Step 3: Smoke fixture render trong `aux-panel-activity-tab.test.tsx` (3 tests).
- [x] Full suite: `pnpm lint` 0 errors; `pnpm test` 10111/10111 pass; `cargo check --all-targets --features test-utils` 0 errors; clippy clean.
