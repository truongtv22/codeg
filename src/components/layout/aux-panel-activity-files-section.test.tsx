/**
 * The activity tab's Files Changes section: a row per cumulative file, the
 * A/M/R chip, and the lazy per-file diff expand — the diff text rides in with
 * the stat (built once when the transcript grouped its turns), so expanding
 * only mounts the renderer, and a deleted file (nothing to diff) has no
 * expand control at all.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"

import enMessages from "@/i18n/messages/en.json"
import type { FileChangeStat } from "@/lib/session-files"

import { ActivityFilesSection } from "./aux-panel-activity-files-section"

vi.mock("@/hooks/use-open-file-target", () => ({
  useOpenFileTarget: () => vi.fn(async () => {}),
}))

function stat(over: Partial<FileChangeStat> & { id: string }): FileChangeStat {
  return {
    path: over.id,
    additions: 1,
    deletions: 0,
    diff: null,
    ...over,
  }
}

function renderSection(files: FileChangeStat[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ActivityFilesSection files={files} />
    </NextIntlClientProvider>
  )
}

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
-old line
+new line
 context`

describe("ActivityFilesSection", () => {
  it("renders no diff and no expand control while collapsed", () => {
    renderSection([stat({ id: "f1", path: "src/a.ts", diff: DIFF })])
    expect(screen.getByTitle("src/a.ts")).toBeVisible()
    expect(screen.queryByText(/new line/)).not.toBeInTheDocument()
  })

  it("expands the file's diff on first click, collapses on the second", async () => {
    const user = userEvent.setup()
    renderSection([stat({ id: "f1", path: "src/a.ts", diff: DIFF })])
    const toggle = screen.getByRole("button", { name: "Show diff" })
    await user.click(toggle)
    expect(screen.getByText(/new line/)).toBeVisible()
    expect(screen.getByRole("button", { name: "Hide diff" })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Hide diff" }))
    expect(screen.queryByText(/new line/)).not.toBeInTheDocument()
  })

  it("offers no expand control for a file without a diff", () => {
    renderSection([stat({ id: "f1", path: "src/read-only.txt", diff: null })])
    expect(screen.getByTitle("src/read-only.txt")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Show diff" })).toBeNull()
  })

  it("offers no expand control for a deleted file even with diff text", () => {
    renderSection([
      stat({
        id: "f1",
        path: "src/gone.ts",
        diff: `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-gone`,
      }),
    ])
    // Deleted rows render line-through, no path button, no diff toggle.
    expect(screen.queryByRole("button", { name: "Show diff" })).toBeNull()
    expect(screen.getByTitle("src/gone.ts")).toBeVisible()
  })
})
