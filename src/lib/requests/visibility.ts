/**
 * Who may see which request, and from which stage.
 *
 * `request.view_all` used to mean "every request in the city, at every stage",
 * which handed the GSO side an office's slips while they were still an internal
 * draft — filed, unendorsed, nobody outside the department having agreed they
 * should be asked for. GSO has no business with a request until its own head
 * signs it, and the queues say so: the checker works `pending`, the head works
 * `recommended`. Seeing further back than you can act is not scope, it is a
 * leak.
 *
 * So the permission now means "every request **from `pending` on**", and there
 * are two ways a request is visible:
 *
 * - it belongs to one of your own offices — any stage, including unendorsed
 * - it reached GSO's desk, and you hold `request.view_all`
 *
 * "Reached GSO's desk" is a question about the slip's history, not only its
 * current status: a request the department rejected or withdrew before endorsing
 * it never left the department, and reads as terminal rather than as pre-GSO.
 * `STATUS_RULE` below is where that is decided, status by status.
 *
 * The one exception is `request.endorse` **together with** `request.view_all`,
 * which is admin and only admin: the documented escape hatch for an office
 * whose head is away. Endorsing a slip you cannot see is not a thing, so the
 * visibility follows the verb.
 *
 * Plain functions, not `"use server"` — the actions call them, and the whole
 * point is that one rule answers for the list, the detail reads, and the
 * dashboard tiles rather than three predicates drifting apart.
 */

import type { RequestStatus } from "@/types/database"

/** A timestamp column whose presence proves the slip reached GSO. */
type ArrivalStamp = "endorsed_at" | "reviewed_at"

/**
 * What each status says about whether the slip is GSO's business, as one record
 * so the compiler counts the statuses for us: adding a value to `RequestStatus`
 * without deciding which side of the boundary it falls on is a type error here
 * rather than a leak.
 *
 * - `pre_gso` — never left the department. Own offices only.
 * - `gso` — reached GSO's desk by definition. Visible with `request.view_all`.
 * - a column name — **terminal, and the status alone does not say where it
 *   died**, so that column decides: a value means the slip reached GSO before
 *   it stopped, `NULL` means it never did.
 *
 * The two terminal cases are why this is a record of rules and not two lists.
 * A request the department head **rejected** at endorsement and one GSO
 * rejected both read `rejected`, and `endorsed_at` cannot tell them apart —
 * the head's rejection stamps it too. `reviewed_at` can: only GSO's decision
 * writes it. A **cancelled** slip is the mirror image; nobody reviewed it, so
 * the endorsement that put it on GSO's desk is the only proof it ever got
 * there, and `endorsed_at` is exactly that.
 */
const STATUS_RULE: Record<RequestStatus, "pre_gso" | "gso" | ArrivalStamp> = {
  awaiting_endorsement: "pre_gso",
  pending: "gso",
  recommended: "gso",
  approved: "gso",
  partially_released: "gso",
  released: "gso",
  rejected: "reviewed_at",
  cancelled: "endorsed_at",
}

/** Statuses another office's request is visible at unconditionally. */
const GSO_VISIBLE_STATUSES: readonly RequestStatus[] = (
  Object.keys(STATUS_RULE) as RequestStatus[]
).filter((status) => STATUS_RULE[status] === "gso")

/**
 * Statuses visible only with the stamp beside them — `[status, column]` pairs,
 * so the SQL filter and the in-code predicate are generated from one table and
 * cannot disagree about which column decides.
 */
const CONDITIONAL_STATUSES: readonly [RequestStatus, ArrivalStamp][] = (
  Object.keys(STATUS_RULE) as RequestStatus[]
)
  .map((status) => [status, STATUS_RULE[status]] as const)
  .filter(
    (pair): pair is [RequestStatus, ArrivalStamp] =>
      pair[1] !== "pre_gso" && pair[1] !== "gso"
  )

function isPreGsoStatus(status: RequestStatus): boolean {
  return STATUS_RULE[status] === "pre_gso"
}

export interface RequestVisibility {
  /** Offices whose requests are visible at every stage — `ctx.officeIds`. */
  officeIds: string[]
  /** Other offices' requests are visible from `pending` on. */
  seesOtherOffices: boolean
  /** Other offices' unendorsed slips are visible too. Admin only. */
  seesUnendorsedEverywhere: boolean
}

/** Reads the rule off a session context. Takes the fields, not the client. */
export function requestVisibility(ctx: {
  officeIds: string[]
  canViewAll: boolean
  permissions: string[]
}): RequestVisibility {
  return {
    officeIds: ctx.officeIds,
    seesOtherOffices: ctx.canViewAll,
    seesUnendorsedEverywhere:
      ctx.canViewAll && ctx.permissions.includes("request.endorse"),
  }
}

/**
 * One request, as much of it as the rule needs.
 *
 * The two stamps are optional because most callers read a request whose status
 * cannot be terminal — a release exists, or an edit is underway — and a `select`
 * listing columns the rule will not consult is a column list that goes stale.
 * A missing stamp reads as "never reached GSO", so the cost of forgetting one is
 * a request wrongly *hidden* from GSO: a visible bug, in the safe direction.
 */
export interface VisibilityTarget {
  office_id: string
  status: RequestStatus
  /** Set by the endorsement — **and** by the head's rejection at that stage. */
  endorsed_at?: string | null
  /** Set only by GSO's own decision: approval or rejection. */
  reviewed_at?: string | null
}

/**
 * Whether the slip ever got past its own department. `false` for the pre-GSO
 * stage, `true` for the live stages, and for a terminal one whatever the stamp
 * that status nominates says.
 */
function reachedGso(request: VisibilityTarget): boolean {
  const rule = STATUS_RULE[request.status]
  if (rule === "pre_gso") return false
  if (rule === "gso") return true
  return request[rule] != null
}

/** Whether one request is visible. The detail reads and the activity feed. */
export function canViewRequest(
  visibility: RequestVisibility,
  request: VisibilityTarget
): boolean {
  if (visibility.officeIds.includes(request.office_id)) return true
  if (!visibility.seesOtherOffices) return false
  // Admin's escape hatch is total: they can act at the pre-GSO stage, so a slip
  // that died there is inside their view rather than a hole in it.
  if (visibility.seesUnendorsedEverywhere) return true
  return reachedGso(request)
}

/**
 * How a query over the `requests` table has to be narrowed.
 *
 * A discriminated union rather than "an office list or null", because the
 * interesting case is neither: a GSO user's own office is visible at every
 * stage *and* every other office is visible from `pending` on, which is one
 * `or` and not an `.in()` at all. Returning null for it — the shape a
 * nullable office list pushes you towards — is exactly the leak this module
 * exists to close.
 */
export type RequestQueryScope =
  /** No filter: every request, every stage. */
  | { kind: "all" }
  /** `.in("office_id", officeIds)`. Empty means nothing is visible. */
  | { kind: "offices"; officeIds: string[] }
  /** Own offices at any stage, plus every office from `pending` on. */
  | { kind: "split"; officeIds: string[] }

/**
 * The scope for a query, given the statuses it already filters on.
 *
 * Pass the statuses when the query has them — a count of `pending` needs no
 * office filter for a GSO user, and a count of `awaiting_endorsement` needs
 * nothing *but* one, so naming them collapses the `split` case into a plain
 * `.in()` and saves the caller an `or`. A terminal status collapses to neither:
 * whether it is visible depends on a stamp, so it stays `split`. Omit the
 * statuses (the list page, which filters in the browser) and the answer is
 * `split` too.
 */
export function requestQueryScope(
  visibility: RequestVisibility,
  statuses?: readonly RequestStatus[]
): RequestQueryScope {
  if (!visibility.seesOtherOffices) {
    return { kind: "offices", officeIds: visibility.officeIds }
  }
  if (visibility.seesUnendorsedEverywhere) return { kind: "all" }

  if (statuses && statuses.length > 0) {
    if (statuses.every(isPreGsoStatus)) {
      return { kind: "offices", officeIds: visibility.officeIds }
    }
    if (statuses.every((status) => STATUS_RULE[status] === "gso")) {
      return { kind: "all" }
    }
  }

  return { kind: "split", officeIds: visibility.officeIds }
}

/**
 * The `split` scope as a PostgREST `or` expression, for `.or(...)`.
 *
 * One clause per way of being visible, generated from `STATUS_RULE` so the SQL
 * and `canViewRequest` cannot drift:
 *
 *     office_id.in.(…),
 *     status.in.(pending,recommended,approved,partially_released,released),
 *     and(status.eq.rejected,reviewed_at.not.is.null),
 *     and(status.eq.cancelled,endorsed_at.not.is.null)
 *
 * Everything is stated positively — `in.()` and `not.is.null` inside `and()` —
 * rather than as a negation of the hidden set, because the hidden set is the
 * part that depends on a column and "not (A and B)" is the shape that goes
 * wrong quietly. With no offices of your own the office clause would be an
 * empty `in.()`, which is not a filter worth trusting to mean "nothing", so it
 * is left out entirely.
 */
export function requestVisibilityOrFilter(officeIds: string[]): string {
  const clauses = [`status.in.(${GSO_VISIBLE_STATUSES.join(",")})`]

  for (const [status, stamp] of CONDITIONAL_STATUSES) {
    clauses.push(`and(status.eq.${status},${stamp}.not.is.null)`)
  }

  if (officeIds.length > 0) {
    clauses.unshift(`office_id.in.(${officeIds.join(",")})`)
  }

  return clauses.join(",")
}
