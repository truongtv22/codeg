"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, ChevronRight } from "lucide-react"

import { CompactDiff } from "@/components/diff/compact-diff"
import { ViewModeToggle } from "@/components/diff/unified-diff-preview"
import { NavSubAgentCard } from "@/components/message/nav-sub-agent-card"
import { useActiveFolder } from "@/contexts/active-folder-context"
import type { DelegationCardSource } from "@/hooks/use-delegation-card-model"
import {
  fileNameOf,
  isAddedFileDiff,
  isRemovedFileDiff,
  toFolderRelativePath,
} from "@/lib/file-path-display"
import { useSessionDetailsDiffView } from "@/lib/session-details-prefs"
import type { FileChangeStat } from "@/lib/session-files"
import { cn } from "@/lib/utils"
import { useOpenFileTarget } from "@/hooks/use-open-file-target"

import { InsightsSection } from "./session-details-insights"
import { useSessionDetailsSectionOpen } from "@/lib/session-details-prefs"

/**
 * The session's sub-agents (every settled delegation the loaded transcript
 * holds, as the same card the message navigation renders) and its cumulative
 * file changes: name first, folder path under it, the +/- tallies, and the
 * diff opening under the row in the session's chosen layout.
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
  return (
    <InsightsSection
      title={t("subagents.title")}
      summary={rows.length}
      open={open}
      onOpenChange={setOpen}
    >
      {open &&
        (rows.length === 0 ? (
          <p className="px-1.5 py-1 text-2xs text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.source.parentToolUseId}>
                <NavSubAgentCard source={row.source} />
              </li>
            ))}
          </ul>
        ))}
    </InsightsSection>
  )
}

/**
 * Cumulative files the session touched, one row each: an A/M/R chip (read
 * from the diff when one is attached), the file name with its folder path
 * below (relative to the open folder, like the message navigation's file
 * rows), the green/red line counts, and the diff opening under the row —
 * inline or side by side, the layout the Session Details panel picked.
 */

type FileMode = "added" | "modified" | "deleted"

function fileModeOf(file: FileChangeStat): FileMode {
  if (isRemovedFileDiff(file.diff)) return "deleted"
  if (isAddedFileDiff(file.diff)) return "added"
  return "modified"
}

const MODE_CLASS: Record<FileMode, string> = {
  added: "text-green-600 dark:text-green-400",
  modified: "text-muted-foreground",
  deleted: "text-red-600 dark:text-red-400",
}

/** Added and removed line counts, a zero left out, green/red. */
function DiffStats({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  if (additions === 0 && deletions === 0) return null
  return (
    <span
      dir="ltr"
      className="flex shrink-0 gap-1 font-mono text-2xs tabular-nums"
    >
      {additions > 0 && (
        <span className="text-green-600 dark:text-green-400">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="text-red-600 dark:text-red-400">−{deletions}</span>
      )}
    </span>
  )
}

export function ActivityFilesSection({
  files,
}: {
  files: readonly FileChangeStat[]
}) {
  const t = useTranslations("Folder.activity")
  const [open, setOpen] = useSessionDetailsSectionOpen("files")
  const openFile = useOpenFileTarget()
  const { activeFolder: folder } = useActiveFolder()
  const [view, setView] = useSessionDetailsDiffView()
  // One expanded file at a time keeps the scroll predictable.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  return (
    <InsightsSection
      title={t("files.title")}
      summary={files.length}
      open={open}
      onOpenChange={setOpen}
    >
      {open &&
        (files.length === 0 ? (
          <p className="px-1.5 py-1 text-2xs text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul className="space-y-px">
            {files.map((file) => {
              const mode = fileModeOf(file)
              // The unified diff text rode in with the stat (built once when
              // the transcript grouped its turns) — expanding only mounts the
              // renderer.
              const expandable = file.diff != null && mode !== "deleted"
              const expanded = expandable && expandedId === file.id
              const displayPath = toFolderRelativePath(file.path, folder?.path)
              const name = fileNameOf(displayPath)
              const dir =
                displayPath.length > name.length
                  ? displayPath.slice(0, displayPath.length - name.length - 1)
                  : ""
              return (
                <li key={file.id} className="-mx-1.5 min-w-0 rounded-md px-1.5">
                  <div className="flex h-7 min-w-0 items-center gap-2">
                    <span
                      title={t(`files.mode.${mode}`)}
                      className={cn(
                        "w-4 shrink-0 text-center text-2xs font-semibold tabular-nums",
                        MODE_CLASS[mode]
                      )}
                    >
                      {mode === "deleted" ? "R" : mode === "added" ? "A" : "M"}
                    </span>
                    <span className="min-w-0 flex-1 items-baseline truncate">
                      {mode === "deleted" ? (
                        <span
                          title={displayPath}
                          className="block truncate text-[0.8125rem] text-muted-foreground line-through decoration-muted-foreground/50"
                        >
                          {name}
                        </span>
                      ) : (
                        <button
                          type="button"
                          title={displayPath}
                          onClick={() => void openFile(file.path)}
                          className="block w-full truncate rounded-sm text-start text-[0.8125rem] text-foreground/85 underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {name}
                        </button>
                      )}
                      {dir && (
                        <span
                          title={dir}
                          className="block truncate text-2xs text-muted-foreground"
                        >
                          {dir}
                        </span>
                      )}
                    </span>
                    <DiffStats
                      additions={file.additions}
                      deletions={file.deletions}
                    />
                    {expandable && (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={t(
                          expanded ? "files.hideDiff" : "files.showDiff"
                        )}
                        title={t(
                          expanded ? "files.hideDiff" : "files.showDiff"
                        )}
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
                    <div className="py-1">
                      <div className="flex items-center justify-end pb-1">
                        <ViewModeToggle view={view} onSwitch={setView} />
                      </div>
                      <div className="max-h-80 overflow-y-auto border-t border-border/60 pt-1">
                        <CompactDiff diffText={file.diff} view={view} />
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ))}
    </InsightsSection>
  )
}
