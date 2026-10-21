"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Bot, ChevronRight, Loader2, TerminalIcon } from "lucide-react"

import { InsightsSection } from "./session-details-insights"
import { useSessionDetailsSectionOpen } from "@/lib/session-details-prefs"
import { cn } from "@/lib/utils"
import { useTranscriptInsightsPart } from "@/stores/transcript-insights-store"

/**
 * Live work happening right now in the active session: sub-agents still
 * running (the delegation cards' own status) and background jobs still alive
 * on the adapter's lifecycle channel (`liveAsyncTasks`). A row's stop button
 * follows the same affordance the transcript strip offers.
 */

/** The muted "nothing here" line every empty section shows. */
export function SectionEmpty({ text }: { text: string }) {
  return <p className="px-1.5 py-1 text-2xs text-muted-foreground">{text}</p>
}

/** The state glyph of a settled background task, tinted by its outcome. */
export function BackgroundTaskStateIcon({
  state,
  className,
}: {
  state: string
  className?: string
}) {
  const failed = state !== "completed"
  const Icon = failed ? Loader2 : Bot
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        failed ? "text-destructive" : "text-emerald-500",
        className
      )}
    />
  )
}

/** The glyph of a live background job: shell-ish jobs wear the terminal,
 *  anything else the generic spinner. Mirrors `async-task-strip`. */
export function LiveTaskIcon({ taskType }: { taskType: string }) {
  const Icon = taskType === "shell" ? TerminalIcon : Loader2
  return (
    <Icon
      aria-hidden="true"
      className="size-3.5 shrink-0 animate-spin text-primary"
    />
  )
}

export function ActivityLiveSection({
  runningSubagents,
  liveBackgroundTasks,
}: {
  runningSubagents: number
  liveBackgroundTasks: {
    taskId: string
    name: string
    taskType: string
    onStop?: (taskId: string) => void
  }[]
}) {
  const t = useTranslations("Folder.activity")
  const [open, setOpen] = useSessionDetailsSectionOpen("live")
  const total = runningSubagents + liveBackgroundTasks.length
  return (
    <InsightsSection
      title={t("live.title")}
      summary={total}
      open={open}
      onOpenChange={setOpen}
    >
      {open &&
        (total === 0 ? (
          <SectionEmpty text={t("empty")} />
        ) : (
          <ul className="space-y-px">
            {runningSubagents > 0 && (
              <li className="-mx-1.5 flex h-7 items-center gap-2 rounded-md px-1.5">
                <span className="flex w-7 shrink-0 justify-center">
                  <Loader2
                    aria-hidden="true"
                    className="size-3.5 animate-spin text-blue-500"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground">
                  {t("live.subagents", { count: runningSubagents })}
                </span>
              </li>
            )}
            {liveBackgroundTasks.map((task) => (
              <li
                key={task.taskId}
                className="-mx-1.5 flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5"
              >
                <span className="flex w-7 shrink-0 justify-center">
                  <LiveTaskIcon taskType={task.taskType} />
                </span>
                <span
                  title={task.name}
                  className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground"
                >
                  {task.name}
                </span>
                {task.onStop && (
                  <button
                    type="button"
                    onClick={() => task.onStop?.(task.taskId)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-2xs text-muted-foreground outline-none transition-colors hover:bg-background hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {t("live.stop")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ))}
    </InsightsSection>
  )
}

/** Settled background tasks, parsed from the transcript in Rust. */
export function ActivityBackgroundSection({
  conversationId,
}: {
  conversationId: number | null
}) {
  const t = useTranslations("Folder.activity")
  const [open, setOpen] = useSessionDetailsSectionOpen("backgroundTasks")
  const activity = useTranscriptInsightsPart(conversationId, (i) => i.activity)
  const backgroundTasks = activity?.backgroundTasks ?? []
  return (
    <InsightsSection
      title={t("background.title")}
      summary={backgroundTasks.length}
      open={open}
      onOpenChange={setOpen}
    >
      {open &&
        (backgroundTasks.length === 0 ? (
          <SectionEmpty text={t("empty")} />
        ) : (
          <ul className="space-y-px">
            {backgroundTasks.map((task) => (
              <ActivityBackgroundRowItem key={task.task_id} task={task} />
            ))}
          </ul>
        ))}
    </InsightsSection>
  )
}

/** One settled task: the row, and — folded under it — the command it ran and
 *  what it produced, so the detail answers "what was this, how did it end". */
function ActivityBackgroundRowItem({
  task,
}: {
  task: import("@/lib/types").SessionBackgroundTaskInfo
}) {
  const t = useTranslations("Folder.activity")
  const [expanded, setExpanded] = useState(false)
  const expandable = task.command != null || task.result_summary != null
  return (
    <li className="-mx-1.5 min-w-0 rounded-md px-1.5">
      <div
        className={cn(
          "flex h-7 min-w-0 items-center gap-2",
          expandable && "cursor-pointer"
        )}
        title={`${task.name} · ${task.state}`}
        onClick={expandable ? () => setExpanded((prev) => !prev) : undefined}
      >
        <span className="flex w-7 shrink-0 justify-center">
          <BackgroundTaskStateIcon state={task.state} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground/85">
          {task.name}
        </span>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {t(`background.state.${taskStateKey(task.state)}`)}
        </span>
        {expandable && (
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90"
            )}
          />
        )}
      </div>
      {expanded && expandable && (
        <div className="space-y-1.5 border-t border-border/60 py-1.5">
          {task.command && (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/60 px-1.5 py-1 font-mono text-2xs text-foreground/85 [overflow-wrap:anywhere]">
              {task.command}
            </pre>
          )}
          {task.result_summary && (
            <p className="whitespace-pre-wrap px-0.5 text-2xs leading-4 text-muted-foreground [overflow-wrap:anywhere]">
              {task.result_summary}
            </p>
          )}
          {task.output_file_path && (
            <p className="truncate px-0.5 text-2xs text-muted-foreground">
              {task.output_file_path}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/** The parser's settled-state vocabulary — every key the state label needs. */
const TASK_STATE_KEYS = [
  "completed",
  "failed",
  "stopped",
  "canceled",
  "cancelled",
  "killed",
  "timeout",
  "timed_out",
  "error",
] as const

type TaskStateKey = (typeof TASK_STATE_KEYS)[number]

function taskStateKey(state: string): TaskStateKey {
  return (TASK_STATE_KEYS as readonly string[]).includes(state)
    ? (state as TaskStateKey)
    : "completed"
}

/** Skills the session invoked, tallied in Rust (the `Skill` tool calls and
 *  slash-command invocations the transcript's expansion confirms). */
export function ActivitySkillsSection({
  conversationId,
}: {
  conversationId: number | null
}) {
  const t = useTranslations("Folder.activity")
  const [open, setOpen] = useSessionDetailsSectionOpen("skills")
  const activity = useTranscriptInsightsPart(conversationId, (i) => i.activity)
  const skills = activity?.skills ?? []
  return (
    <InsightsSection
      title={t("skills.title")}
      summary={skills.length}
      open={open}
      onOpenChange={setOpen}
    >
      {open &&
        (skills.length === 0 ? (
          <SectionEmpty text={t("empty")} />
        ) : (
          <ul className="space-y-px">
            {skills.map((skill) => (
              <li
                key={skill.name}
                className="-mx-1.5 flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5"
              >
                <span className="flex w-7 shrink-0 justify-center">
                  <Bot
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground/85">
                  {skill.name}
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                  {t("skills.calls", { count: skill.call_count })}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </InsightsSection>
  )
}
