"use client"

/**
 * The topbar bell. Its feed is derived from `requests.status` on every fetch
 * (see `src/lib/notifications/feed.ts`), so there is nothing to mark as read —
 * an item leaves when the request it describes actually moves.
 *
 * The feed lives in client state, which means `revalidatePath` from the request
 * actions does **not** reach it. Three things refresh it instead: a 60s poll,
 * window focus, and a pathname change. The last is what makes the badge drop
 * the moment you endorse something and land back on the list; the poll is the
 * backstop for acting without navigating away.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { formatDistanceToNow } from "date-fns"
import { Bell } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { StatusBadge } from "@/components/shared/status-badge"
import { getNotifications } from "@/lib/actions/notifications"
import {
  EMPTY_FEED,
  SECTION_LABEL,
  type NotificationFeed,
  type NotificationItem,
  type NotificationKind,
} from "@/lib/notifications/feed"
import { cn } from "@/lib/utils"

const POLL_MS = 60_000

function relative(at: string | null): string {
  if (!at) return ""
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ""
  return formatDistanceToNow(date, { addSuffix: true })
}

/** Groups in the order `buildFeed` already sorted them — no re-sorting here. */
function groupByKind(items: NotificationItem[]) {
  const groups: { kind: NotificationKind; items: NotificationItem[] }[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.kind === item.kind) last.items.push(item)
    else groups.push({ kind: item.kind, items: [item] })
  }
  return groups
}

function Row({
  item,
  onSelect,
}: {
  item: NotificationItem
  onSelect: (item: NotificationItem) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="flex w-full flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold text-foreground">
          {item.requestNo}
        </span>
        <span className="ml-auto shrink-0">
          <StatusBadge status={item.status} />
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{item.headline}</p>
      {(item.office || item.requester) && (
        <p className="truncate text-xs text-muted-foreground/80">
          {[item.office, item.requester].filter(Boolean).join(" · ")}
        </p>
      )}
      {item.at && (
        <p className="text-[11px] text-muted-foreground/70">{relative(item.at)}</p>
      )}
    </button>
  )
}

function Section({
  label,
  items,
  onSelect,
}: {
  label: string
  items: NotificationItem[]
  onSelect: (item: NotificationItem) => void
}) {
  return (
    <div className="space-y-0.5">
      <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {label}
      </p>
      {items.map((item) => (
        <Row key={`${item.kind}-${item.id}`} item={item} onSelect={onSelect} />
      ))}
    </div>
  )
}

export function NotificationBell() {
  const router = useRouter()
  const pathname = usePathname()
  const [feed, setFeed] = useState<NotificationFeed>(EMPTY_FEED)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)

  // A slow fetch that resolves after a newer one must not overwrite it.
  const requestSeq = useRef(0)

  /** Resolves to `null` when a newer fetch has already been issued. */
  const fetchFeed = useCallback(async () => {
    const seq = ++requestSeq.current
    const result = await getNotifications()
    return seq === requestSeq.current ? result : null
  }, [])

  // The state write lives in the `.then` callback rather than after an `await`
  // in the effect body: both land in a callback at runtime, but only this form
  // is legible as one to `react-hooks/set-state-in-effect`.
  const refresh = useCallback(
    () =>
      fetchFeed().then((result) => {
        if (!result) return
        setError(result.error)
        setFeed(result.data)
        setLoaded(true)
      }),
    [fetchFeed]
  )

  useEffect(() => {
    void refresh()
  }, [refresh, pathname])

  useEffect(() => {
    const timer = setInterval(() => void refresh(), POLL_MS)
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [refresh])

  const onSelect = (item: NotificationItem) => {
    setOpen(false)
    router.push(item.href)
  }

  const { actionable, recent, count, truncated } = feed
  const hasAnything = actionable.length > 0 || recent.length > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={
          count > 0 ? `Notifications — ${count} awaiting you` : "Notifications"
        }
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center",
              "rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white"
            )}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[360px] max-w-[calc(100vw-2rem)] gap-0 p-0"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          {count > 0 && (
            <span className="text-xs text-muted-foreground">
              {count} awaiting you
            </span>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto p-1">
          {error ? (
            <p className="px-2.5 py-6 text-center text-sm text-destructive">
              {error}
            </p>
          ) : !loaded ? (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : !hasAnything ? (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
              You&rsquo;re all caught up.
            </p>
          ) : (
            <>
              {groupByKind(actionable).map((group) => (
                <Section
                  key={group.kind}
                  label={SECTION_LABEL[group.kind]}
                  items={group.items}
                  onSelect={onSelect}
                />
              ))}
              {truncated && (
                <p className="px-2.5 py-2 text-[11px] text-muted-foreground/70">
                  Showing {actionable.length} of {count}.{" "}
                  <span className="underline-offset-2">
                    Open Requests for the full list.
                  </span>
                </p>
              )}
              {recent.length > 0 && (
                <Section
                  label={SECTION_LABEL.outcome}
                  items={recent}
                  onSelect={onSelect}
                />
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
