"use client"

import { useTranslations } from "next-intl"
import { Eye, RotateCcw } from "lucide-react"

import { cn } from "@/lib/utils"
import type { DelegationCardSource } from "@/hooks/use-delegation-card-model"
import { useDelegationCardModel } from "@/hooks/use-delegation-card-model"
import {
  DelegationIdentityAvatar,
  DelegationIdentityName,
} from "@/components/message/delegation-identity"
import { StatusBadge } from "@/components/message/delegation-status-badge"
import { useSessionViewerHost } from "@/components/message/session-viewer-host-context"

/**
 * A settled sub-agent, as the transcript's delegation cards render it: who
 * ran it with its status badge, its task below, and — once it has a
 * conversation — the eye that opens it (the whole card does). Used by the
 * Activity tab; the message navigation draws its own line instead.
 */
export function NavSubAgentCard({ source }: { source: DelegationCardSource }) {
  const t = useTranslations("Folder.chat.delegation")
  const viewerHost = useSessionViewerHost()
  const { identity, task, status, errorCode, childConversationId } =
    useDelegationCardModel(source)
  // A `resume_delegation` brought this sub-agent back.
  const resumed = source.taskIdHint != null

  const body = (
    <span className="flex min-w-0 flex-1 items-center gap-2.5 py-2 ps-2.5 pe-2">
      {/* ponytail: `header` is the 28px size; upstream dropped `compact`,
          which this card used. Same diameter, square-ish corners. */}
      <DelegationIdentityAvatar
        identity={identity}
        size="header"
        badge={
          resumed ? (
            <span
              className="inline-flex size-3.5 items-center justify-center rounded-full border border-border bg-background"
              title={t("resumed")}
            >
              <RotateCcw className="size-2 text-muted-foreground" />
            </span>
          ) : undefined
        }
      />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <DelegationIdentityName
            identity={identity}
            className="min-w-0 truncate text-xs font-semibold text-foreground"
          />
          <StatusBadge status={status} errorCode={errorCode} />
        </span>
        {task && (
          <span
            className="block truncate text-2xs text-muted-foreground"
            title={task}
          >
            {task}
          </span>
        )}
      </span>
    </span>
  )

  const card =
    "flex w-full min-w-0 items-stretch overflow-hidden rounded-lg border border-border bg-card text-start"
  // The panel brings its own viewer host; without one there is nowhere to
  // show the conversation, and the card only reports.
  if (childConversationId != null && viewerHost) {
    return (
      <button
        type="button"
        data-testid="nav-sub-agent"
        title={t("openDetail")}
        onClick={() => viewerHost.open({ kind: "delegation", source })}
        className={cn(
          card,
          "group/agent outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        )}
      >
        {body}
        <span
          aria-hidden="true"
          className="flex w-8 shrink-0 items-center justify-center border-s border-border text-foreground/70 transition-colors group-hover/agent:text-foreground"
        >
          <Eye className="size-3.5" />
        </span>
      </button>
    )
  }
  return (
    <div data-testid="nav-sub-agent" className={card}>
      {body}
    </div>
  )
}
