"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, ChevronRight, Eye } from "lucide-react"

import { InsightsSection } from "./session-details-insights"
import { useSessionDetailsSectionOpen } from "@/lib/session-details-prefs"
import { isAddedFileDiff, isRemovedFileDiff } from "@/lib/file-path-display"
import type { FileChangeStat } from "@/lib/session-files"
import { cn } from "@/lib/utils"
import { useOpenFileTarget } from "@/hooks/use-open-file-target"
import { CompactDiff } from "@/components/diff/compact-diff"
import type { DelegationCardSource } from "@/hooks/use-delegation-card-model"
import { useDelegationCardModel } from "@/hooks/use-delegation-card-model"
import {
  DelegationIdentityAvatar,
  DelegationIdentityName,
} from "@/components/message/delegation-identity"
import { StatusBadge } from "@/components/message/delegation-status-badge"
import { useSessionViewerHost } from "@/components/message/session-viewer-host-context"

/**
 * The session's sub-agents (every `delegate_to_agent` call the loaded
 * transcript holds) and its cumulative file changes. Sub-agent rows resolve
 * through the same card model the transcript's delegation cards use, so
 * status and identity never disagree.
 */

export interface ActivitySubagentRow {
  source: DelegationCardSource
}

export function ActivitySubagentsSection({
  rows,
}: {
  rows: readonly ActivitySubagentRow[]
}) {
  const t = useTranslations("Folder.activity")
  const [open, setOpen] = useSessionDetailsSectionOpen("subagents")
  if (rows.length === 0) return null
  return (
    <InsightsSection
      title={t("subagents.title")}
      summary={rows.length}
      open={open}
      onOpenChange={setOpen}
    >
      {open && (
        <ul className="space-y-px">
          {rows.map((row) => (
            <ActivitySubagentRowItem
              key={row.source.parentToolUseId}
              row={row}
            />
          ))}
        </ul>
      )}
    </InsightsSection>
  )
}

function ActivitySubagentRowItem({ row }: { row: ActivitySubagentRow }) {
  const { identity, task, status, errorCode, childConversationId } =
    useDelegationCardModel(row.source)
  const viewerHost = useSessionViewerHost()
  const t = useTranslations("Folder.chat.delegation")
  return (
    <li>
      <button
        type="button"
        title={t("openDetail")}
        onClick={() =>
          viewerHost?.open({ kind: "delegation", source: row.source })
        }
        className="-mx-1.5 flex h-7 w-[calc(100%+0.75rem)] min-w-0 items-center gap-2 rounded-md px-1.5 text-start outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="flex w-7 shrink-0 justify-center">
          <DelegationIdentityAvatar identity={identity} size="compact" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground/85">
          <DelegationIdentityName
            identity={identity}
            className="text-[0.8125rem] font-medium text-foreground"
          />
          {task && <span className="text-muted-foreground"> · {task}</span>}
        </span>
        {status && (
          <span className="shrink-0">
            <StatusBadge status={status} errorCode={errorCode} size="sm" />
          </span>
        )}
        {childConversationId != null && viewerHost && (
          <Eye
            aria-hidden="true"
            className="size-3 shrink-0 text-muted-foreground"
          />
        )}
      </button>
    </li>
  )
}

/**
 * Cumulative files the session touched, one row each: an A/M/R chip (read from
 * the diff when one is attached), the path, and the line counts. The path
 * opens the file the same way the transcript's file rows do. Phase 4 adds the
 * lazy per-file diff expand.
 */

type FileMode = "added" | "modified" | "deleted"

function fileModeOf(file: FileChangeStat): FileMode {
  if (isRemovedFileDiff(file.diff)) return "deleted"
  if (isAddedFileDiff(file.diff)) return "added"
  return "modified"
}

const MODE_CLASS: Record<FileMode, string> = {
  added: "text-emerald-500",
  modified: "text-muted-foreground",
  deleted: "text-destructive",
}

export function ActivityFilesSection({
  files,
}: {
  files: readonly FileChangeStat[]
}) {
  const t = useTranslations("Folder.activity")
  const [open, setOpen] = useSessionDetailsSectionOpen("files")
  const openFile = useOpenFileTarget()
  // One expanded file at a time keeps the scroll predictable.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (files.length === 0) return null
  return (
    <InsightsSection
      title={t("files.title")}
      summary={files.length}
      open={open}
      onOpenChange={setOpen}
    >
      {open && (
        <ul className="space-y-px">
          {files.map((file) => {
            const mode = fileModeOf(file)
            // The unified diff text rode in with the stat (built once when the
            // transcript grouped its turns, cached per turn) — expanding only
            // mounts the renderer.
            const expandable = file.diff != null && mode !== "deleted"
            const expanded = expandable && expandedId === file.id
            return (
              <li key={file.id} className="-mx-1.5 min-w-0 rounded-md px-1.5">
                <div className="flex h-7 min-w-0 items-center gap-2">
                  <span
                    title={t(`files.mode.${mode}`)}
                    className={cn(
                      "w-7 shrink-0 text-center text-2xs font-semibold tabular-nums",
                      MODE_CLASS[mode]
                    )}
                  >
                    {mode === "deleted" ? "R" : mode === "added" ? "A" : "M"}
                  </span>
                  {mode === "deleted" ? (
                    <span
                      title={file.path}
                      className="min-w-0 flex-1 truncate text-[0.8125rem] text-muted-foreground line-through decoration-muted-foreground/50"
                    >
                      {file.path}
                    </span>
                  ) : (
                    <button
                      type="button"
                      title={file.path}
                      onClick={() => void openFile(file.path)}
                      className="min-w-0 flex-1 truncate rounded-sm text-start text-[0.8125rem] text-foreground/85 underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {file.path}
                    </button>
                  )}
                  <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                    +{file.additions} −{file.deletions}
                  </span>
                  {expandable && (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={t(
                        expanded ? "files.hideDiff" : "files.showDiff"
                      )}
                      title={t(expanded ? "files.hideDiff" : "files.showDiff")}
                      onClick={() => setExpandedId(expanded ? null : file.id)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {expanded ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                  )}
                </div>
                {expanded && file.diff && (
                  <div className="max-h-80 overflow-y-auto border-t border-border/60 py-1">
                    <CompactDiff diffText={file.diff} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </InsightsSection>
  )
}
