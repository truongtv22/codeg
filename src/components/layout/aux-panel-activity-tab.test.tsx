/**
 * The aux panel's Activity tab: the sub-agent rows resolve through the
 * delegation card model (one row per delegation source, opened in the
 * session viewer), and the Rust-parsed tallies (settled background tasks,
 * skills) read the transcript's published activity part.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { DelegationCardSource } from "@/hooks/use-delegation-card-model"
import {
  publishTranscriptInsights,
  retractTranscriptInsights,
  useTranscriptInsightsStore,
} from "@/stores/transcript-insights-store"

const scene = vi.hoisted(() => ({
  open: vi.fn(),
  cardModel: null as Pick<
    import("@/hooks/use-delegation-card-model").DelegationCardModel,
    "identity" | "task" | "status" | "childConversationId"
  > | null,
}))

vi.mock("@/contexts/aux-panel-context", () => ({
  useAuxPanelContext: () => ({ isOpen: true, activeTab: "activity" }),
}))
// The active conversation tab (id 1): the tab the runtime id — and the
// published activity the tab reads — come from.
vi.mock("@/contexts/tab-context", () => ({
  useTabStore: (selector: (s: unknown) => unknown) =>
    selector({
      tabs: [{ id: "tab-1", conversationId: 1, runtimeConversationId: 1 }],
      activeTabId: "tab-1",
    }),
}))
vi.mock("@/hooks/use-delegation-card-model", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/use-delegation-card-model")>()
  return {
    ...actual,
    useDelegationCardModel: () => scene.cardModel,
  }
})
vi.mock("@/lib/api", () => ({
  acpStopAsyncTask: vi.fn(async () => true),
}))
vi.mock("@/hooks/use-open-file-target", () => ({
  useOpenFileTarget: () => vi.fn(async () => {}),
}))

// No provider in this test: the tab's connection lookup reads the optional
// store, gets null, and the live section just renders no rows.
vi.mock("@/contexts/acp-connections-context", () => ({
  useConnectionStore: () => null,
  useOptionalConnectionStore: () => null,
}))
// The viewer host pulls the whole workspace action surface; the tab's tests
// only care that rows call `open` — a provider carrying the spy is enough.
vi.mock(
  "@/components/message/session-viewer-host-context",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/message/session-viewer-host-context")
      >()
    return {
      ...actual,
      useSessionViewerHost: () => ({ open: scene.open }),
    }
  }
)

import { ActivityTab } from "./aux-panel-activity-tab"

function source(parentToolUseId: string): DelegationCardSource {
  return { parentToolUseId }
}

const CARD = {
  identity: { agentType: "claude", assistantId: null, assistantName: null },
  task: "scan the parsers",
  status: "ok" as const,
  childConversationId: null,
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ActivityTab />
    </NextIntlClientProvider>
  )
}

describe("ActivityTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scene.cardModel = null
    useTranscriptInsightsStore.setState({
      byConversationId: new Map(),
      navDemand: new Map(),
      activityDemand: new Map(),
    })
  })

  it("renders an empty panel with no published activity", () => {
    renderTab()
    // Nothing settled or live: the Live section (total 0) renders nothing.
    expect(screen.queryByText("Subagents")).not.toBeInTheDocument()
    expect(screen.queryByText("Background tasks")).not.toBeInTheDocument()
    expect(screen.queryByText("Skills used")).not.toBeInTheDocument()
  })

  it("lists a settled sub-agent row from the published delegation sources and opens it in the viewer", async () => {
    const user = userEvent.setup()
    // The card model the row resolves through.
    scene.cardModel = {
      ...CARD,
      childConversationId: 42,
    }
    publishTranscriptInsights(1, "t", {
      nav: {
        count: 0,
        entries: [],
        earlier: null,
        revealingTurnId: null,
        currentTurnId: null,
      },
      plan: { entries: [], streaming: false },
      activity: {
        files: [],
        backgroundTasks: [],
        skills: [],
        delegationSources: [source("tu-1")],
      },
      actions: { selectNavEntry: vi.fn(), retryEarlierNav: vi.fn() },
    })
    renderTab()
    expect(screen.getByText("Subagents")).toBeVisible()
    // The row button (not the section header) opens the viewer.
    await user.click(screen.getByTitle("Open conversation"))
    expect(scene.open).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "delegation" })
    )
    retractTranscriptInsights(1, "t")
  })

  it("shows the Rust-parsed background tasks and skills, and no files section while nothing published", () => {
    publishTranscriptInsights(1, "t", {
      nav: {
        count: 0,
        entries: [],
        earlier: null,
        revealingTurnId: null,
        currentTurnId: null,
      },
      plan: { entries: [], streaming: false },
      activity: {
        files: [],
        backgroundTasks: [
          {
            task_id: "bg-1",
            name: "sleep 120",
            task_type: "shell",
            state: "failed",
          },
        ],
        skills: [{ name: "code-review", call_count: 2, last_used_at: null }],
        delegationSources: [],
      },
      actions: { selectNavEntry: vi.fn(), retryEarlierNav: vi.fn() },
    })
    renderTab()
    expect(screen.getByText("Background tasks")).toBeVisible()
    expect(screen.getByText("sleep 120")).toBeVisible()
    expect(screen.getByText("failed")).toBeVisible()
    expect(screen.getByText("Skills used")).toBeVisible()
    expect(screen.getByText("code-review")).toBeVisible()
    expect(screen.getByText("2 calls")).toBeVisible()
    expect(screen.queryByText("Files changed")).not.toBeInTheDocument()
    retractTranscriptInsights(1, "t")
  })
})
