"use server"

import { requireSession, toError, SCHEMA } from "@/lib/auth/session"
import {
  buildFeed,
  EMPTY_FEED,
  RECENT_WINDOW_DAYS,
  type NotificationFeed,
  type NotificationKind,
  type NotificationRequestRow,
  type NotificationSource,
} from "@/lib/notifications/feed"
import type { ActionResult } from "@/types/database"

/** Narrow on purpose — the bell shows a request number, an office, and a time. */
const NOTIFICATION_SELECT = `
  id, request_no, status, requested_at, updated_at,
  office:offices!office_id(code, name),
  requester:user_profiles!requested_by(full_name)
`

/** Per bucket. The badge still reports the exact total past this. */
const LIST_LIMIT = 20

/**
 * Every request that is waiting on the signed-in user, plus their own recently
 * finished slips.
 *
 * Each bucket reuses the *same* predicate the corresponding action enforces —
 * `endorseRequest`'s office match, `approveRequest`'s `pending`, the release
 * dialog's `approved | partially_released`. That is not a coincidence to be
 * maintained by hand: if the bell drifted from the action it would advertise
 * work the server then refuses, which is worse than no bell at all.
 *
 * The buckets are built on **disjoint status sets** so their exact counts can
 * simply be summed. `pickup` is the one that could have collided with
 * `release` — both read `approved | partially_released` — so it is skipped
 * entirely for `request.release` holders, who see the more actionable verb.
 */
export async function getNotifications(): Promise<
  ActionResult<NotificationFeed>
> {
  try {
    const ctx = await requireSession()

    const canEndorse = ctx.permissions.includes("request.endorse")
    const canApprove = ctx.permissions.includes("request.approve")
    const canRelease = ctx.permissions.includes("request.release")

    // Scoped users with no office have nothing they could act on — and
    // `.eq("office_id", null)` would quietly match nothing anyway.
    const scopedOffice = ctx.canViewAll ? null : ctx.profile.office_id
    if (!ctx.canViewAll && !scopedOffice) {
      return { error: null, data: EMPTY_FEED }
    }

    /** Oldest first: `.limit()` must keep the *longest waiting* rows, not the newest. */
    const queue = (statuses: string[]) => {
      const q = ctx.supabase
        .schema(SCHEMA)
        .from("requests")
        .select(NOTIFICATION_SELECT, { count: "exact" })
        .in("status", statuses)
        .order("updated_at", { ascending: true })
        .limit(LIST_LIMIT)
      return scopedOffice ? q.eq("office_id", scopedOffice) : q
    }

    /** The viewer's own slips — scoped by author, so no office filter needed. */
    const mine = (statuses: string[], newestFirst = false) =>
      ctx.supabase
        .schema(SCHEMA)
        .from("requests")
        .select(NOTIFICATION_SELECT, { count: "exact" })
        .eq("requested_by", ctx.userId)
        .in("status", statuses)
        .order("updated_at", { ascending: !newestFirst })
        .limit(LIST_LIMIT)

    const cutoff = new Date(
      Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()

    const planned: { kind: NotificationKind; query: PromiseLike<unknown> }[] = []

    if (canEndorse) {
      planned.push({ kind: "endorse", query: queue(["awaiting_endorsement"]) })
    }
    if (canApprove) {
      planned.push({ kind: "review", query: queue(["pending"]) })
    }
    if (canRelease) {
      planned.push({
        kind: "release",
        query: queue(["approved", "partially_released"]),
      })
    } else {
      planned.push({
        kind: "pickup",
        query: mine(["approved", "partially_released"]),
      })
    }

    planned.push({
      kind: "outcome",
      query: mine(["released", "rejected"], true).gte("updated_at", cutoff),
    })

    const settled = (await Promise.all(planned.map((p) => p.query))) as {
      data: NotificationRequestRow[] | null
      count: number | null
      error: { message: string } | null
    }[]

    const failure = settled.find((r) => r.error)
    if (failure?.error) return { error: failure.error.message, data: EMPTY_FEED }

    const sources: NotificationSource[] = settled.map((result, i) => ({
      kind: planned[i].kind,
      rows: (result.data ?? []) as unknown as NotificationRequestRow[],
      total: result.count ?? (result.data ?? []).length,
    }))

    return { error: null, data: buildFeed(sources) }
  } catch (e) {
    return { error: toError(e), data: EMPTY_FEED }
  }
}
