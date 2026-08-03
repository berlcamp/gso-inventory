/**
 * Turns raw request rows into the notification feed the topbar bell renders.
 *
 * A notification here is **derived**, never stored: "needs your action" is
 * entirely a function of `requests.status` plus the viewer's role and office,
 * so there is no notifications table to fall out of step with the request it
 * describes. The cost is that there is no per-item read state — a row leaves
 * the bell when the request actually moves, which is the only thing that
 * should clear it anyway.
 *
 * Plain module, deliberately **not** `"use server"` — it exports types and pure
 * functions that the action calls, the same split as
 * `src/lib/inventory/availability.ts`. That is also what makes it testable
 * without a Supabase client; see `feed.test.ts`.
 */

import type { RequestStatus } from "@/types/database"

export type NotificationKind =
  /** Filed for your office, waiting on you as its department head. */
  | "endorse"
  /** Endorsed and sitting on GSO's desk. */
  | "review"
  /** Approved — GSO still has to hand it over the counter. */
  | "release"
  /** Approved — *you* filed it, so it is yours to go and collect. */
  | "pickup"
  /** Finished: rejected or released. News, not a task. */
  | "outcome"

/**
 * Actionable kinds, most urgent first. This order decides both the section
 * order in the panel and — when one request somehow lands in two buckets —
 * which verb wins.
 */
export const ACTIONABLE_KINDS = [
  "endorse",
  "review",
  "release",
  "pickup",
] as const satisfies readonly NotificationKind[]

/** The columns the action selects. Kept narrow — the bell shows four fields. */
export interface NotificationRequestRow {
  id: string
  request_no: string
  status: RequestStatus
  requested_at: string | null
  updated_at: string | null
  office: { code: string; name: string } | null
  requester: { full_name: string } | null
}

/** One bucket's worth of rows, plus the true total before the fetch's limit. */
export interface NotificationSource {
  kind: NotificationKind
  rows: NotificationRequestRow[]
  /** Exact count from PostgREST, i.e. before `.limit()` truncated `rows`. */
  total: number
}

export interface NotificationItem {
  id: string
  requestNo: string
  kind: NotificationKind
  status: RequestStatus
  headline: string
  /** `"ACCTG · City Accounting Office"`, or null if the join came back empty. */
  office: string | null
  requester: string | null
  /** When the request last moved — drives the relative timestamp. */
  at: string | null
  href: string
}

export interface NotificationFeed {
  /** Things waiting on the viewer, oldest first within each kind. */
  actionable: NotificationItem[]
  /** Recently finished slips the viewer filed, newest first. */
  recent: NotificationItem[]
  /** The badge number. Counts `actionable` only — see `buildFeed`. */
  count: number
  /** `count` exceeds what `actionable` lists, so the panel is showing a slice. */
  truncated: boolean
}

const KIND_HEADLINE: Record<Exclude<NotificationKind, "outcome">, string> = {
  endorse: "Needs your endorsement",
  review: "Waiting for GSO review",
  release: "Ready to release",
  pickup: "Approved — ready for pickup at GSO",
}

const OUTCOME_HEADLINE: Partial<Record<RequestStatus, string>> = {
  released: "Released",
  rejected: "Rejected",
}

export const SECTION_LABEL: Record<NotificationKind, string> = {
  endorse: "For your endorsement",
  review: "For GSO review",
  release: "For release",
  pickup: "Ready for pickup",
  outcome: "Recent",
}

/** How long a finished slip stays in the panel. Without read state, something
 *  has to age these out, and a week survives a weekend without hoarding. */
export const RECENT_WINDOW_DAYS = 7

function timeOf(row: NotificationRequestRow): string | null {
  return row.updated_at ?? row.requested_at
}

/** Nulls sort last in both directions — an undated row is never the headline. */
function compareAt(a: NotificationRequestRow, b: NotificationRequestRow, dir: 1 | -1) {
  const x = timeOf(a)
  const y = timeOf(b)
  if (x === y) return 0
  if (x === null) return 1
  if (y === null) return -1
  return x < y ? -dir : dir
}

function toItem(
  row: NotificationRequestRow,
  kind: NotificationKind
): NotificationItem {
  return {
    id: row.id,
    requestNo: row.request_no,
    kind,
    status: row.status,
    headline:
      kind === "outcome"
        ? (OUTCOME_HEADLINE[row.status] ?? "Updated")
        : KIND_HEADLINE[kind],
    office: row.office ? `${row.office.code} · ${row.office.name}` : null,
    requester: row.requester?.full_name ?? null,
    at: timeOf(row),
    href: `/dashboard/requests/${row.id}`,
  }
}

/**
 * Merges the per-bucket fetches into one feed.
 *
 * Actionable rows are ordered **oldest first** — the bell is a work queue, and
 * the slip that has been waiting five days outranks the one filed a minute ago.
 * `recent` is the opposite, newest first, because it is news rather than work.
 *
 * The badge counts actionable items only. Outcomes deliberately do not light
 * it: nothing clears them but time, so counting them would leave every user
 * with a badge that never reaches zero and therefore means nothing.
 */
export function buildFeed(sources: NotificationSource[]): NotificationFeed {
  const byKind = new Map(sources.map((source) => [source.kind, source]))
  const seen = new Set<string>()
  const actionable: NotificationItem[] = []
  let count = 0

  for (const kind of ACTIONABLE_KINDS) {
    const source = byKind.get(kind)
    if (!source) continue

    const fresh = source.rows.filter((row) => !seen.has(row.id))
    for (const row of fresh) seen.add(row.id)

    actionable.push(
      ...fresh
        .slice()
        .sort((a, b) => compareAt(a, b, 1))
        .map((row) => toItem(row, kind))
    )

    // `total` is the count *before* the fetch's `.limit()`, so it can exceed
    // `rows.length` — that is the whole point of asking for it, otherwise a
    // busy GSO desk would show a badge of 20 forever. Subtract only the overlap
    // actually observed in `rows`: the action builds its buckets on disjoint
    // status sets, so overlap outside the fetched window cannot exist, and
    // guessing at it would corrupt an otherwise exact number.
    count += Math.max(0, source.total - (source.rows.length - fresh.length))
  }

  const recent = (byKind.get("outcome")?.rows ?? [])
    .filter((row) => !seen.has(row.id))
    .slice()
    .sort((a, b) => compareAt(a, b, -1))
    .map((row) => toItem(row, "outcome"))

  return { actionable, recent, count, truncated: count > actionable.length }
}

export const EMPTY_FEED: NotificationFeed = {
  actionable: [],
  recent: [],
  count: 0,
  truncated: false,
}
