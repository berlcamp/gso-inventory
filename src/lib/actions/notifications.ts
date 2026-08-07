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
import {
  requestQueryScope,
  requestVisibility,
  requestVisibilityOrFilter,
} from "@/lib/requests/visibility"
import type { ActionResult, RequestStatus } from "@/types/database"

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

/**
 * The same four fields again, reached through a ledger row.
 *
 * A void has no table of its own — it *is* the `stock_movements` row, which is
 * the point of the design: the correction, its timestamp, its author and its
 * reason live in the audit trail rather than in a parallel notifications table
 * that could disagree with it. `!inner` for the same two reasons as above.
 */
const VOID_NOTIFICATION_SELECT = `
  id, created_at,
  request:requests!request_id!inner(
    id, request_no, status, requested_at, office_id,
    office:offices!office_id(code, name),
    requester:user_profiles!requested_by(full_name)
  )
`

/** Per bucket. The badge still reports the exact total past this. */
const LIST_LIMIT = 20

/**
 * What `RELEASE_NOTIFICATION_SELECT` and `VOID_NOTIFICATION_SELECT` come back
 * as, before flattening. The two differ only in which column carries the time,
 * so `at` is read off whichever one the query asked for.
 */
interface ReleaseNotificationRow {
  id: string
  released_at?: string | null
  created_at?: string | null
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
 * Flattens a release or ledger row onto the request shape the feed renders.
 *
 * `updated_at` is set to when the *event* happened — when the goods went out,
 * or when the line was voided — not when the request last changed. The
 * actionable queues are ordered oldest-first and what matters there is how long
 * a delivery has gone unsigned-for; the news section is newest-first and what
 * matters is when GSO made the correction. Reading the request's own
 * `updated_at` would answer neither, since several of these events can share
 * one request.
 */
function fromRelease(row: ReleaseNotificationRow): NotificationRequestRow | null {
  if (!row.request) return null
  return {
    id: row.request.id,
    request_no: row.request.request_no,
    status: row.request.status,
    requested_at: row.request.requested_at,
    updated_at: row.released_at ?? row.created_at ?? null,
    office: row.request.office,
    requester: row.request.requester,
  }
}

/**
 * Every request that is waiting on the signed-in user, plus their own recently
 * finished slips.
 *
 * Each bucket reuses the *same* predicate the corresponding action enforces —
 * `endorseRequest`'s office match, `recommendRequest`'s `pending`,
 * `approveRequest`'s `recommended`, the release dialog's
 * `approved | partially_released`. That is not a coincidence to be
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
    const canRecommend = ctx.permissions.includes("request.recommend")
    const canApprove = ctx.permissions.includes("request.approve")
    const canRelease = ctx.permissions.includes("request.release")
    const canAcknowledge = ctx.permissions.includes("request.acknowledge")

    const visibility = requestVisibility(ctx)

    // Scoped users with no office have nothing they could act on. A user may
    // cover several offices, so this is a set and the queues use `.in()`.
    const scopedOffices = ctx.canViewAll ? null : ctx.officeIds
    if (scopedOffices && scopedOffices.length === 0) {
      return { error: null, data: EMPTY_FEED }
    }

    /**
     * Oldest first: `.limit()` must keep the *longest waiting* rows, not the
     * newest.
     *
     * The office scope comes from `requestQueryScope` on the bucket's own
     * statuses rather than from `scopedOffices`, which is the same answer today
     * and stays the right one if the roles move: a bell that offered a GSO user
     * an unendorsed slip would be advertising a request the list hides and the
     * detail page refuses. `split` cannot arise — every bucket names its
     * statuses and none mixes the pre-GSO stage with a later one — but it is
     * handled rather than assumed away.
     */
    const queue = (statuses: RequestStatus[]) => {
      const scope = requestQueryScope(visibility, statuses)
      const q = ctx.supabase
        .schema(SCHEMA)
        .from("requests")
        .select(NOTIFICATION_SELECT, { count: "exact" })
        .in("status", statuses)
        .order("updated_at", { ascending: true })
        .limit(LIST_LIMIT)

      if (scope.kind === "offices") return q.in("office_id", scope.officeIds)
      if (scope.kind === "split") {
        return q.or(requestVisibilityOrFilter(scope.officeIds))
      }
      return q
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

      if (scopedOffices) q = q.in("request.office_id", scopedOffices)
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
    // Still disjoint by status, so the counts stay summable: `pending` is the
    // checker's queue and `recommended` is the head's, and no request is both.
    if (canRecommend) {
      planned.push({ kind: "check", query: queue(["pending"]) })
    }
    if (canApprove) {
      planned.push({ kind: "review", query: queue(["recommended"]) })
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
    // Scoped users only: `scopedOffices` is null for `request.view_all`
    // holders, and the RPC refuses to let anyone sign for an office they are
    // not in, so an unscoped bell entry would advertise work the server would
    // then refuse.
    if (canAcknowledge && scopedOffices) {
      planned.push({
        kind: "confirm",
        query: releaseQueue("pending", ctx.userId),
        fromReleases: true,
      })
    }

    // Voided releases — news for the office the goods were charged to, so its
    // supply officer and head both learn that something the slip says was
    // delivered has been taken back off their balance. Without this the only
    // trace on their side is a status quietly sliding from Released back to
    // Partially Released, which nobody is watching for.
    //
    // Scoped users only, exactly like `confirm`: `scopedOffices` is null for
    // `request.view_all` holders, and a void is GSO's own action — telling the
    // desk that performed it about it is not news, it is an echo.
    //
    // Keyed on the ledger rather than on `requests`, because the request's
    // status does not record that a void happened and its `updated_at` cannot
    // distinguish one from any other edit. `buildFeed` collapses several voided
    // lines on one slip down to a single entry.
    if (scopedOffices) {
      planned.push({
        kind: "void",
        query: ctx.supabase
          .schema(SCHEMA)
          .from("stock_movements")
          .select(VOID_NOTIFICATION_SELECT, { count: "exact" })
          .eq("movement_type", "void")
          .gte("created_at", cutoff)
          .in("request.office_id", scopedOffices)
          .order("created_at", { ascending: false })
          .limit(LIST_LIMIT),
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
