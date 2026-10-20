"use client"

import { useEffect, useMemo, useCallback } from "react"
import { useSyncExternalStore } from "react"

import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { useTabStore } from "@/contexts/tab-context"
import {
  useOptionalConnectionStore,
  type ConnectionState,
} from "@/contexts/acp-connections-context"
import {
  demandTranscriptActivity,
  useTranscriptInsightsPart,
} from "@/stores/transcript-insights-store"
import { acpStopAsyncTask } from "@/lib/api"
import { liveAsyncTasks } from "@/lib/async-tasks"
import { SessionViewerHost } from "@/components/message/session-viewer-host"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ActivityBackgroundSection,
  ActivityLiveSection,
  ActivitySkillsSection,
} from "./aux-panel-activity-sections"
import {
  ActivityFilesSection,
  ActivitySubagentsSection,
} from "./aux-panel-activity-files-section"

/**
 * The aux-panel "Activity" tab, right after Session Details: what this session
 * is doing and has done — live sub-agents and background jobs, every settled
 * sub-agent, the background tasks the transcript settled, the files it changed
 * (cumulative) and the skills it invoked.
 *
 * Files and the Rust-parsed tallies (skills, settled background tasks) come
 * from the transcript's published insights; the tab demands them only while it
 * is on screen, the way the Session Details panel demands the navigator rows.
 */
export function ActivityTab() {
  const { isOpen, activeTab } = useAuxPanelContext()
  const active = isOpen && activeTab === "activity"

  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  // The connection key IS the tab id: the connection rides the tab whose
  // agent is live, so the active conversation tab's id looks it up.
  const activeConversationTabId = useMemo(
    () =>
      tabs.find((tab) => tab.id === activeTabId && tab.conversationId != null)
        ?.id ?? null,
    [tabs, activeTabId]
  )

  // Outside an AcpConnectionsProvider (a bare test, a viewer-only surface)
  // there is simply no live connection: null is a supported answer.
  const store = useOptionalConnectionStore()
  const subscribeConnection = useCallback(
    (cb: () => void) => {
      if (!store || !activeConversationTabId) return () => {}
      return store.subscribeKey(activeConversationTabId, cb)
    },
    [store, activeConversationTabId]
  )
  const getConnectionSnapshot = useCallback(
    () =>
      store && activeConversationTabId
        ? (store.getConnection(activeConversationTabId) ?? null)
        : null,
    [store, activeConversationTabId]
  )
  const connection = useSyncExternalStore(
    subscribeConnection,
    getConnectionSnapshot,
    getConnectionSnapshot
  )

  // Demand the file list while the tab is on screen — grouping walks every
  // turn's tool calls, so the transcript derives it only for a reader.
  const runtimeId = useRuntimeConversationId(activeConversationTabId)
  useEffect(() => {
    if (!active || runtimeId == null) return
    return demandTranscriptActivity(runtimeId)
  }, [active, runtimeId])

  const delegationSources = useTranscriptInsightsPart(
    runtimeId,
    (i) => i.activity.delegationSources
  )
  const subagentRows = useMemo(
    () => (delegationSources ?? []).map((source) => ({ source })),
    [delegationSources]
  )

  const liveTasks = useMemo(
    () => (connection ? liveAsyncTasks(connection.asyncTasks) : []),
    [connection]
  )
  const handleStopTask = useMemo(
    () =>
      connection && !connection.isViewer
        ? (taskId: string) =>
            void acpStopAsyncTask(connection.connectionId, taskId)
        : undefined,
    [connection]
  )

  // ponytail: live sub-agent count is a placeholder — delegation cards own the
  // live status today; wire broker counts here when a session lists them.
  const runningSubagents = 0

  return (
    <SessionViewerHost>
      <ScrollArea className="h-full">
        <div className="min-w-0 space-y-4 p-3 text-sm">
          <ActivityLiveSection
            runningSubagents={runningSubagents}
            liveBackgroundTasks={liveTasks.map((task) => ({
              taskId: task.task_id,
              name: task.name,
              taskType: task.task_type,
              // Like the composer's async-task strip: only tasks the adapter
              // reports stoppable get a Stop button.
              onStop: task.can_stop ? handleStopTask : undefined,
            }))}
          />
          <ActivitySubagentsSection rows={subagentRows} />
          <ActivityBackgroundSection conversationId={runtimeId} />
          <ActivityFilesSection files={useActivityFiles(runtimeId)} />
          <ActivitySkillsSection conversationId={runtimeId} />
        </div>
      </ScrollArea>
    </SessionViewerHost>
  )
}

/** The tab's runtime conversation id (the id the transcript publishes under). */
function useRuntimeConversationId(tabId: string | null): number | null {
  const runtimeId = useTabStore((s) => {
    if (tabId == null) return null
    const tab = s.tabs.find((t) => t.id === tabId)
    return tab?.runtimeConversationId ?? tab?.conversationId ?? null
  })
  return runtimeId
}

/** The transcript's cumulative file list, published only while demanded. */
function useActivityFiles(
  conversationId: number | null
): readonly import("@/lib/session-files").FileChangeStat[] {
  const activity = useTranscriptInsightsPart(conversationId, (i) => i.activity)
  return activity?.files ?? []
}

// Reference keep: the connection shape the tab reads (revisit when the tab
// grows per-connection sections).
export type { ConnectionState }
