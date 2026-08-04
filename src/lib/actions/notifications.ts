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

/**
 * The same four fields, reached through a release instead of a request.
 *
 * `!inner` is load-bearing: it makes the embed a join so the office filter
 * below applies, and a release whose request somehow vanished drops out rather
 * than arriving as a row with a null request the mapper has to guess at.
 */
const RELEASE_NOTIFICATION_SELECT = `
  id, released_at,
  request:requests!request_id!inner(
    id, request_no, status, requested_at, office_id,
    office:offices!office_id(code, name),
    requester:user_profiles!requested_by(full_name)
  )
`

/** Per bucket. The badge still reports the exact total past this. */
const LIST_LIMIT = 20

/** What `RELEASE_NOTIFICATION_SELECT` comes back as, before flattening. */
interface ReleaseNotificationRow {
  id: string
  released_at: string | null
  request: {
    id: string
    request_no: string
    status: NotificationRequestRow["status"]
    requested_at: string | null
    office: { code: string; name: string } | null
    requester: { full_name: string } | null
  } | null
}

/**
 * Flattens a release row onto the request shape the feed renders.
 *
 * `updated_at` is set to when the goods went out, not when the request last
 * changed: these queues are ordered oldest-first, and what matters is how long
 * a delivery has gone unsigned-for.
 */
function fromRelease(row: ReleaseNotificationRow): NotificationRequestRow | null {
  if (!row.request) return null
  return {
    id: row.request.id,
    request_no: row.request.request_no,
    status: row.request.status,
    requested_at: row.request.requested_at,
    updated_at: row.released_at,
    office: row.request.office,
    requester: row.request.requester,
  }
}

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
    const canAcknowledge = ctx.permissions.includes("request.acknowledge")

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

    /**
     * Releases in a given acknowledgement state, oldest first. Unresolved only:
     * a dispute GSO has already settled is history, and leaving it in the queue
     * would give every GSO user a badge that never reaches zero.
     */
    const releaseQueue = (ackStatus: string, excludeReleasedBy?: string) => {
      let q = ctx.supabase
        .schema(SCHEMA)
        .from("request_releases")
        .select(RELEASE_NOTIFICATION_SELECT, { count: "exact" })
        .eq("ack_status", ackStatus)
        .is("dispute_resolved_at", null)

      if (scopedOffice) q = q.eq("request.office_id", scopedOffice)
      // Mirrors the RPC's two-man rule: a release you recorded is not yours to
      // sign for, so it is not work and does not belong in your bell.
      if (excludeReleasedBy) q = q.neq("released_by", excludeReleasedBy)

      return q.order("released_at", { ascending: true }).limit(LIST_LIMIT)
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

    const planned: {
      kind: NotificationKind
      query: PromiseLike<unknown>
      /** Rows come from `request_releases` and need flattening first. */
      fromReleases?: boolean
    }[] = []

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
      // Settling a discrepancy is GSO's job — the same desk that issued the
      // goods and that would make any corrective adjustment.
      planned.push({
        kind: "dispute",
        query: releaseQueue("disputed"),
        fromReleases: true,
      })
    } else {
      planned.push({
        kind: "pickup",
        query: mine(["approved", "partially_released"]),
      })
    }
    // Scoped users only: `scopedOffice` is null for `request.view_all` holders,
    // and the RPC refuses to let anyone sign for an office they are not in, so
    // an unscoped bell entry would advertise work the server would then refuse.
    if (canAcknowledge && scopedOffice) {
      planned.push({
        kind: "confirm",
        query: releaseQueue("pending", ctx.userId),
        fromReleases: true,
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

    const sources: NotificationSource[] = settled.map((result, i) => {
      const raw = result.data ?? []
      const rows = planned[i].fromReleases
        ? (raw as unknown as ReleaseNotificationRow[])
            .map(fromRelease)
            .filter((row): row is NotificationRequestRow => row !== null)
        : (raw as unknown as NotificationRequestRow[])

      return {
        kind: planned[i].kind,
        rows,
        total: result.count ?? rows.length,
      }
    })

    return { error: null, data: buildFeed(sources) }
  } catch (e) {
    return { error: toError(e), data: EMPTY_FEED }
  }
}
