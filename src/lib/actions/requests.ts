"use server"

import { revalidatePath } from "next/cache"
import {
  requireSession,
  requirePermission,
  toError,
  SCHEMA,
  type SessionContext,
} from "@/lib/auth/session"
import {
  acknowledgeReleaseSchema,
  requestUpdateSchema,
  supplyRequestSchema,
  voidReleaseItemSchema,
} from "@/lib/schemas/gso"
import { getSystemSettings } from "@/lib/actions/settings"
import {
  checkAgainstAvailability,
  loadAvailability,
} from "@/lib/inventory/availability"
import {
  canViewRequest,
  requestQueryScope,
  requestVisibility,
  requestVisibilityOrFilter,
} from "@/lib/requests/visibility"
import type {
  ActionResult,
  DeliveryReceiptData,
  ItemAvailability,
  RequestLogRow,
  RequestReleaseRow,
  RequestStatus,
  SupplyRequestRow,
} from "@/types/database"

// `request_releases(id, ack_status)` rides along so the list can show where
// each slip stands with the office that received it. Two columns of a table
// with a handful of rows per request — cheaper than a second round trip, and
// PostgREST has no way to aggregate it down to one status server-side.
const REQUEST_SELECT = `
  *,
  office:offices!office_id(id, name, code),
  requester:user_profiles!requested_by(id, full_name, email),
  endorser:user_profiles!endorsed_by(id, full_name),
  recommender:user_profiles!recommended_by(id, full_name),
  reviewer:user_profiles!reviewed_by(id, full_name),
  releaser:user_profiles!released_by(id, full_name),
  request_releases(id, ack_status)
`

const REQUEST_DETAIL_SELECT = `
  *,
  office:offices!office_id(id, name, code),
  requester:user_profiles!requested_by(id, full_name, email),
  endorser:user_profiles!endorsed_by(id, full_name),
  recommender:user_profiles!recommended_by(id, full_name),
  reviewer:user_profiles!reviewed_by(id, full_name),
  releaser:user_profiles!released_by(id, full_name),
  request_items(
    *,
    item:items(*, category:categories(id, name), unit:units(id, code, name))
  )
`

/**
 * One wording for every read that refuses. The two halves of the rule are both
 * in it on purpose: "not yours" alone reads as a bug to a GSO user who can see
 * the same office's other slips.
 */
const REQUEST_NOT_VISIBLE =
  "You can only view your own offices' requests, and other offices' requests once they have been endorsed to GSO."

/* ── Department head helpers ───────────────────────────────────────────── */

/**
 * Whether the caller may **act** on this office's slip.
 *
 * Deliberately not the same question as whether they may see it — that one is
 * `canViewRequest` in `@/lib/requests/visibility`, and it is narrower: GSO sees
 * another office's request only from `pending` on. Acting is gated by status and
 * permission on top of this, so a wider office rule here cannot let anyone into
 * a stage that is not theirs, and `request.view_all` holders staying unscoped is
 * what keeps admin able to unblock a slip whose head is away.
 *
 * A department head acts on their **own** offices only, exactly as a supply
 * officer is scoped to theirs.
 *
 * `officeIds` is a set because one person can cover several departments — see
 * `SessionContext.officeIds`.
 *
 * Not exported: a `"use server"` module may only export async functions.
 */
function canActForOffice(ctx: SessionContext, officeId: string): boolean {
  return ctx.canViewAll || ctx.officeIds.includes(officeId)
}

/**
 * Whether the office has anyone who could endorse a request filed for it.
 *
 * Filing is refused when it does not — the alternative is a slip that sits at
 * `awaiting_endorsement` with nobody able to move it, which fails silently
 * days later instead of at the moment someone can still do something about it.
 */
async function officeHasDepartmentHead(
  ctx: SessionContext,
  officeId: string
): Promise<boolean> {
  // Two ways to be in an office: it is your primary, or you hold a membership
  // row for it. Both are read, matching `SessionContext.officeIds` — a head
  // who covers this office as their *second* department can endorse for it,
  // and refusing to count them would block the office from filing at all.
  const [primary, extra] = await Promise.all([
    ctx.supabase
      .schema(SCHEMA)
      .from("user_profiles")
      .select("id, user_roles(role:roles(code))")
      .eq("office_id", officeId)
      .eq("is_active", true),
    ctx.supabase
      .schema(SCHEMA)
      .from("user_offices")
      .select("user:user_profiles!inner(id, is_active, user_roles(role:roles(code)))")
      .eq("office_id", officeId)
      .eq("user.is_active", true),
  ])

  type RoleBearer = { user_roles: { role: { code: string } | null }[] | null }

  const candidates: RoleBearer[] = [
    ...((primary.data ?? []) as unknown as RoleBearer[]),
    ...((extra.data ?? []) as unknown as { user: RoleBearer | null }[])
      .map((row) => row.user)
      .filter((u): u is RoleBearer => u !== null),
  ]

  return candidates.some((profile) =>
    (profile.user_roles ?? []).some((ur) => ur.role?.code === "department_head")
  )
}

/* ── Reads ─────────────────────────────────────────────────────────────── */

/**
 * Every request the caller may see, unpaginated — the requests table filters in
 * the browser. Grows over a fiscal year but stays in the low thousands: one row
 * per requisition slip, not per line item.
 *
 * "May see" is `requestQueryScope`: own offices at every stage, and every other
 * office only from `pending` on. The page filters in the browser, so this query
 * carries no status of its own and gets the `split` scope — one `or`, because
 * neither an office list nor an unfiltered read expresses it.
 */
export async function getAllRequests(): Promise<
  ActionResult<SupplyRequestRow[]>
> {
  try {
    const ctx = await requireSession()

    let query = ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select(REQUEST_SELECT)
      .order("requested_at", { ascending: false })

    const scope = requestQueryScope(requestVisibility(ctx))
    if (scope.kind === "offices") {
      if (scope.officeIds.length === 0) return { error: null, data: [] }
      query = query.in("office_id", scope.officeIds)
    } else if (scope.kind === "split") {
      query = query.or(requestVisibilityOrFilter(scope.officeIds))
    }

    const { data, error } = await query
    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as unknown as SupplyRequestRow[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function getRequest(
  id: string
): Promise<ActionResult<SupplyRequestRow | null>> {
  try {
    const ctx = await requireSession()

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select(REQUEST_DETAIL_SELECT)
      .eq("id", id)
      .maybeSingle()

    if (error) return { error: error.message, data: null }
    if (!data) return { error: "Request not found.", data: null }

    const row = data as unknown as SupplyRequestRow

    // Not `canActForOffice`: GSO sees another office's slip from `pending` on,
    // and a request nobody has endorsed yet is the department's own business.
    // Without this, the list hid it and the URL handed it over anyway.
    if (!canViewRequest(requestVisibility(ctx), row)) {
      return { error: REQUEST_NOT_VISIBLE, data: null }
    }

    return { error: null, data: row }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * The request's timeline. Scoped like the request itself: the log names who did
 * what to a slip and why, which is no more public than the slip.
 */
export async function getRequestLogs(
  requestId: string
): Promise<ActionResult<RequestLogRow[]>> {
  try {
    const ctx = await requireSession()

    const { data: request } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("office_id, status, endorsed_at, reviewed_at")
      .eq("id", requestId)
      .maybeSingle()

    if (!request) return { error: "Request not found.", data: [] }
    if (
      !canViewRequest(requestVisibility(ctx), {
        office_id: request.office_id as string,
        status: request.status as RequestStatus,
      })
    ) {
      return { error: REQUEST_NOT_VISIBLE, data: [] }
    }

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_logs")
      .select("*, actor:user_profiles!actor_id(id, full_name)")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true })

    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as unknown as RequestLogRow[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

/**
 * Every trip to the counter this request has had, oldest first, with the lines
 * that went out on each and where it stands with the receiving office.
 *
 * Scoped the same way `getRequest` is: releases carry quantities and names, so
 * they are no more public than the request they belong to.
 */
export async function getRequestReleases(
  requestId: string
): Promise<ActionResult<RequestReleaseRow[]>> {
  try {
    const ctx = await requireSession()

    const { data: request } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("office_id, status, endorsed_at, reviewed_at")
      .eq("id", requestId)
      .maybeSingle()

    if (!request) return { error: "Request not found.", data: [] }
    if (
      !canViewRequest(requestVisibility(ctx), {
        office_id: request.office_id as string,
        status: request.status as RequestStatus,
      })
    ) {
      return { error: REQUEST_NOT_VISIBLE, data: [] }
    }

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_releases")
      .select(
        `
        *,
        releaser:user_profiles!released_by(id, full_name),
        acknowledger:user_profiles!acknowledged_by(id, full_name),
        resolver:user_profiles!dispute_resolved_by(id, full_name),
        request_release_items(
          *,
          item:items(*, category:categories(id, name), unit:units(id, code, name))
        )
      `
      )
      .eq("request_id", requestId)
      .order("released_at", { ascending: true })

    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as unknown as RequestReleaseRow[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

/**
 * One release and the slip it came off, for the printable delivery receipt.
 *
 * Fetched by release id rather than by request id because the paper is per
 * *trip*: a partially released request prints one receipt now and another when
 * the rest goes out, each listing only what physically moved that time. Reading
 * the whole request and picking a release out of it client-side would put the
 * other trips' quantities on a page that must only carry this one's.
 *
 * The request is embedded rather than fetched separately so the visibility
 * check and the printed data come from the same row — a second read could not
 * disagree today, but it is the kind of gap that only has to open once.
 */
export async function getReleaseForReceipt(
  releaseId: string
): Promise<ActionResult<DeliveryReceiptData | null>> {
  try {
    const ctx = await requireSession()

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_releases")
      .select(
        `
        *,
        releaser:user_profiles!released_by(id, full_name),
        acknowledger:user_profiles!acknowledged_by(id, full_name),
        resolver:user_profiles!dispute_resolved_by(id, full_name),
        request_release_items(
          *,
          item:items(*, category:categories(id, name), unit:units(id, code, name))
        ),
        request:requests!request_id(
          id, request_no, purpose, fiscal_year,
          office_id, status, endorsed_at, reviewed_at,
          office:offices!office_id(id, name, code),
          requester:user_profiles!requested_by(id, full_name)
        )
      `
      )
      .eq("id", releaseId)
      .maybeSingle()

    if (error) return { error: error.message, data: null }
    if (!data) return { error: "Release not found.", data: null }

    const { request, ...release } = data as unknown as RequestReleaseRow & {
      request: DeliveryReceiptData["request"] & {
        office_id: string
        status: RequestStatus
        endorsed_at: string | null
        reviewed_at: string | null
      }
    }

    if (!request) return { error: "Release not found.", data: null }
    if (
      !canViewRequest(requestVisibility(ctx), {
        office_id: request.office_id,
        status: request.status,
        endorsed_at: request.endorsed_at,
        reviewed_at: request.reviewed_at,
      })
    ) {
      return { error: REQUEST_NOT_VISIBLE, data: null }
    }

    return { error: null, data: { release, request } }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * Availability for every item on a request, keyed by item id.
 *
 * The reviewer needs the same arithmetic the approval check runs, otherwise the
 * screen says "6 remaining" and the submit says "only 5 available". The
 * request's own lines are excluded from `committed` — a request does not
 * compete with itself.
 */
export async function getRequestAvailability(
  requestId: string
): Promise<ActionResult<Record<string, ItemAvailability>>> {
  try {
    const ctx = await requireSession()

    const { data: request } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select(
        "office_id, status, endorsed_at, reviewed_at, fiscal_year, request_items(item_id)"
      )
      .eq("id", requestId)
      .maybeSingle()

    if (!request) return { error: "Request not found.", data: {} }

    const row = request as unknown as {
      office_id: string
      status: RequestStatus
      fiscal_year: number
      request_items: { item_id: string }[] | null
    }

    // These are the office's balances, item by item. Scoped like the request
    // they belong to — the same read the detail page and the edit form make.
    if (!canViewRequest(requestVisibility(ctx), row)) {
      return { error: REQUEST_NOT_VISIBLE, data: {} }
    }
    const itemIds = [...new Set((row.request_items ?? []).map((l) => l.item_id))]

    const availability = await loadAvailability(
      ctx,
      row.office_id,
      itemIds,
      row.fiscal_year,
      requestId
    )

    const map: Record<string, ItemAvailability> = {}
    for (const [itemId, entry] of availability) {
      const balance = entry.balance ?? 0
      map[itemId] = {
        balance,
        committed: entry.committed,
        available: balance - entry.committed,
      }
    }
    return { error: null, data: map }
  } catch (e) {
    return { error: toError(e), data: {} }
  }
}

/* ── Writes ────────────────────────────────────────────────────────────── */

export async function createRequest(
  input: unknown
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const ctx = await requirePermission("request.create")
    const parsed = supplyRequestSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, data: null }
    }
    const values = parsed.data

    // A supply officer may only file for an office they are assigned to —
    // any of them, since one person can cover several departments.
    if (!canActForOffice(ctx, values.office_id)) {
      return {
        error: "You can only file requests for your own office.",
        data: null,
      }
    }

    // Collapse duplicate item lines before writing (the table is unique per item).
    const merged = new Map<string, { quantity: number; remarks?: string | null }>()
    for (const line of values.lines) {
      const existing = merged.get(line.item_id)
      merged.set(line.item_id, {
        quantity: (existing?.quantity ?? 0) + line.quantity,
        remarks: line.remarks ?? existing?.remarks ?? null,
      })
    }

    // Reject what could never be released: an item the office has no
    // allocation for, or more than is genuinely left.
    //
    // The fiscal year comes from settings rather than the wall clock, and is
    // then written onto the request explicitly. `office_stocks` is keyed by
    // fiscal year and `release_request` reads it back off the request, so
    // validating against a different year than the row ends up with would let
    // a bad line through — which is exactly what the DB default risked doing
    // around New Year, when Postgres `now()` and the app server can disagree.
    const { data: settings } = await getSystemSettings()
    const fiscalYear = settings.fiscal_year
    const availability = await loadAvailability(
      ctx,
      values.office_id,
      [...merged.keys()],
      fiscalYear
    )
    const problem = checkAgainstAvailability(
      [...merged.entries()].map(([item_id, line]) => ({
        item_id,
        quantity: line.quantity,
      })),
      availability,
      fiscalYear,
      settings.allow_over_release
    )
    if (problem) return { error: problem, data: null }

    // The office's own department head signs off before GSO sees this, so the
    // office needs one. Refusing here is louder than letting the slip park at
    // `awaiting_endorsement` with nobody able to move it.
    if (!(await officeHasDepartmentHead(ctx, values.office_id))) {
      return {
        error:
          "Your office has no department head assigned yet, so this request has nobody to endorse it. Ask an administrator to assign one.",
        data: null,
      }
    }

    const { data: created, error: insertError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .insert({
        office_id: values.office_id,
        requested_by: ctx.userId,
        requester_name: ctx.profile.full_name,
        source: "system",
        status: "awaiting_endorsement",
        purpose: values.purpose,
        remarks: values.remarks ?? null,
        fiscal_year: fiscalYear,
      })
      .select("id")
      .single()

    if (insertError || !created) {
      return { error: insertError?.message ?? "Could not create the request.", data: null }
    }

    const { error: linesError } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_items")
      .insert(
        [...merged.entries()].map(([item_id, line]) => ({
          request_id: created.id,
          item_id,
          quantity_requested: line.quantity,
          remarks: line.remarks ?? null,
        }))
      )

    if (linesError) {
      // Don't leave a headless request behind.
      await ctx.supabase.schema(SCHEMA).from("requests").delete().eq("id", created.id)
      return { error: linesError.message, data: null }
    }

    await ctx.supabase.schema(SCHEMA).from("request_logs").insert({
      request_id: created.id,
      stage: "awaiting_endorsement",
      action: "submitted",
      actor_id: ctx.userId,
      remarks: values.purpose,
    })

    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard")
    return { error: null, data: { id: created.id } }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * Rewrite a slip nobody has endorsed yet — purpose, remarks, and the item list
 * itself, lines added and removed included.
 *
 * Open to **both** desks on the requesting office's own side of the request:
 * the supply officer who files and the department head who is about to endorse.
 * Without it a wrong figure or a forgotten item means cancelling and filing
 * again, which spends a RIS number and the slip's place in the queue on a typo.
 *
 * The window closes at endorsement, and that is the whole safety argument.
 * From `pending` on, the slip carries other people's numbers — endorsed, then
 * recommended, then approved — and each is a ceiling read off the one below it.
 * Editing beneath them would silently re-point a stage nobody revisited: cut a
 * filed quantity under an endorsement and the head's figure now exceeds it,
 * which is the one thing every check downstream assumes cannot happen.
 *
 * A head editing here does overwrite `quantity_requested`, the supply
 * officer's own column. That is the trade this stage asks for, and what keeps
 * it attributable is the `updated` log entry: it records every line that moved
 * and both of its numbers, so the filed figure survives on the timeline instead
 * of being silently replaced.
 */
export async function updateRequest(
  requestId: string,
  input: unknown
): Promise<ActionResult> {
  try {
    const ctx = await requireSession()

    // Either desk on the office's side of the slip. Deliberately not
    // `request.approve`: GSO's answer to a request it cannot fill is to cut it
    // at their own stage, not to rewrite what the office asked for.
    if (
      !ctx.permissions.includes("request.create") &&
      !ctx.permissions.includes("request.endorse")
    ) {
      return {
        error: "You do not have permission to edit supply requests.",
        data: null,
      }
    }

    const parsed = requestUpdateSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, data: null }
    }
    const values = parsed.data

    const { data: request, error: readError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("id, status, office_id, fiscal_year, purpose, remarks")
      .eq("id", requestId)
      .maybeSingle()

    if (readError) return { error: readError.message, data: null }
    if (!request) return { error: "Request not found.", data: null }
    if (request.status !== "awaiting_endorsement") {
      return {
        error:
          "This request has already been endorsed, so it can no longer be edited. File a new request instead.",
        data: null,
      }
    }

    // You cannot edit what you cannot see. `canActForOffice` alone is too wide
    // here: it waives the office match for `request.view_all`, and a GSO user
    // who is also their own office's supply officer holds `request.create` —
    // which would have let them rewrite another department's unendorsed slip,
    // the exact request the list and the detail page now refuse to show them.
    const target = {
      office_id: request.office_id as string,
      status: request.status as RequestStatus,
    }
    if (!canViewRequest(requestVisibility(ctx), target)) {
      return { error: REQUEST_NOT_VISIBLE, data: null }
    }
    if (!canActForOffice(ctx, target.office_id)) {
      return {
        error: "You can only edit requests from your own office.",
        data: null,
      }
    }

    // Collapse duplicate item lines, exactly as filing does — the table is
    // unique per (request, item).
    const merged = new Map<string, number>()
    for (const line of values.lines) {
      merged.set(line.item_id, (merged.get(line.item_id) ?? 0) + line.quantity)
    }

    // The fiscal year comes off the request rather than settings. The row
    // already carries one, `office_stocks` is keyed by it, and `release_request`
    // reads it back off the request — so validating against the year in
    // settings would check a different shelf than the release will draw from if
    // the two have since diverged.
    const fiscalYear = request.fiscal_year as number
    const [availability, { data: settings }] = await Promise.all([
      loadAvailability(
        ctx,
        request.office_id as string,
        [...merged.keys()],
        fiscalYear,
        requestId
      ),
      getSystemSettings(),
    ])
    const problem = checkAgainstAvailability(
      [...merged.entries()].map(([item_id, quantity]) => ({
        item_id,
        quantity,
      })),
      availability,
      fiscalYear,
      settings.allow_over_release
    )
    if (problem) return { error: problem, data: null }

    const { data: existingLines, error: linesError } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_items")
      .select("id, item_id, quantity_requested, item:items(name)")
      .eq("request_id", requestId)

    if (linesError) return { error: linesError.message, data: null }

    const existing = (existingLines ?? []) as unknown as {
      id: string
      item_id: string
      quantity_requested: number
      item: { name: string } | null
    }[]

    // Names for the log entry. Only the added items need looking up — every
    // other name came back with the lines above.
    const nameById = new Map(
      existing.map((l) => [l.item_id, l.item?.name ?? "an item"])
    )
    const addedIds = [...merged.keys()].filter((id) => !nameById.has(id))
    if (addedIds.length > 0) {
      const { data: items } = await ctx.supabase
        .schema(SCHEMA)
        .from("items")
        .select("id, name")
        .in("id", addedIds)
      for (const item of (items ?? []) as { id: string; name: string }[]) {
        nameById.set(item.id, item.name)
      }
    }

    const changes = describeRequestChanges(
      {
        purpose: request.purpose as string,
        remarks: (request.remarks as string | null) ?? null,
        lines: existing,
      },
      { purpose: values.purpose, remarks: values.remarks ?? null, merged },
      nameById
    )

    // Nothing to do, and nothing worth putting on the timeline either — a log
    // row that records no change is noise in the one place the office looks to
    // find out what someone did to their slip.
    if (changes.length === 0) return { error: null, data: null }

    // The header goes first, guarded on the status, and reports whether the
    // predicate matched. If a head endorsed the slip in the meantime, the
    // update touches nothing and bailing here means the lines are never
    // rewritten underneath a stage that has already read them.
    const { data: touched, error: headerError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .update({
        purpose: values.purpose,
        remarks: values.remarks ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "awaiting_endorsement")
      .select("id")

    if (headerError) return { error: headerError.message, data: null }
    if (!touched || touched.length === 0) {
      return {
        error:
          "This request moved on while you were editing it, so nothing was changed. Reload the page to see where it stands.",
        data: null,
      }
    }

    // Added and changed first, removed last: a failure part-way then leaves a
    // line too many rather than a line too few. The slip still asks for at
    // least everything it used to, and editing again finishes the job.
    if (addedIds.length > 0) {
      const { error } = await ctx.supabase
        .schema(SCHEMA)
        .from("request_items")
        .insert(
          addedIds.map((item_id) => ({
            request_id: requestId,
            item_id,
            quantity_requested: merged.get(item_id) ?? 0,
          }))
        )
      if (error) return { error: error.message, data: null }
    }

    for (const line of existing) {
      const quantity = merged.get(line.item_id)
      if (quantity === undefined) continue
      if (Number(line.quantity_requested) === quantity) continue

      const { error } = await ctx.supabase
        .schema(SCHEMA)
        .from("request_items")
        .update({ quantity_requested: quantity })
        .eq("id", line.id)
        .eq("request_id", requestId)
      if (error) return { error: error.message, data: null }
    }

    const removed = existing.filter((l) => !merged.has(l.item_id))
    if (removed.length > 0) {
      const { error } = await ctx.supabase
        .schema(SCHEMA)
        .from("request_items")
        .delete()
        .in(
          "id",
          removed.map((l) => l.id)
        )
        .eq("request_id", requestId)
      if (error) return { error: error.message, data: null }
    }

    await ctx.supabase.schema(SCHEMA).from("request_logs").insert({
      request_id: requestId,
      stage: "awaiting_endorsement",
      action: "updated",
      actor_id: ctx.userId,
      remarks: changes.join("; "),
    })

    revalidatePath(`/dashboard/requests/${requestId}`)
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * What the edit actually did, in words, for the `updated` log entry.
 *
 * This is the whole audit trail for an edit — there is no per-column history —
 * so a changed quantity carries **both** numbers. A head who raises a line here
 * is otherwise indistinguishable from a supply officer who filed that figure in
 * the first place.
 *
 * Not exported: a `"use server"` module may only export async functions.
 */
function describeRequestChanges(
  before: {
    purpose: string
    remarks: string | null
    lines: { item_id: string; quantity_requested: number }[]
  },
  after: { purpose: string; remarks: string | null; merged: Map<string, number> },
  nameById: Map<string, string>
): string[] {
  const changes: string[] = []
  const name = (id: string) => nameById.get(id) ?? "an item"
  const qty = (value: number) => value.toLocaleString()

  for (const line of before.lines) {
    const next = after.merged.get(line.item_id)
    const previous = Number(line.quantity_requested)
    if (next === undefined) {
      changes.push(`removed ${name(line.item_id)} (was ${qty(previous)})`)
    } else if (next !== previous) {
      changes.push(`${name(line.item_id)} ${qty(previous)} → ${qty(next)}`)
    }
  }

  const beforeItems = new Set(before.lines.map((l) => l.item_id))
  for (const [itemId, quantity] of after.merged) {
    if (beforeItems.has(itemId)) continue
    changes.push(`added ${name(itemId)} ${qty(quantity)}`)
  }

  if (before.purpose !== after.purpose) changes.push("purpose revised")
  if ((before.remarks ?? "") !== (after.remarks ?? "")) {
    changes.push("remarks revised")
  }

  // A slip can carry hundreds of lines; the timeline entry is a summary, not a
  // diff. The trailing count is what keeps it from reading as the whole story.
  if (changes.length > 8) {
    return [...changes.slice(0, 8), `and ${changes.length - 8} more changes`]
  }
  return changes
}

/**
 * Endorse a request so it reaches GSO, at the quantities the head stands
 * behind. `lines` maps request_item id → endorsed quantity.
 *
 * The head may **raise as well as cut** — they are the one person who knows
 * what their office actually needs, and the supply officer filing on their
 * behalf can get it wrong in either direction. The ceiling is what the office
 * can still genuinely draw, the same `balance - committed` `createRequest`
 * enforces, so an endorsement can never promise stock that is not there.
 *
 * That is the one place quantities move upward. Everything downstream only
 * cuts: the checker within the endorsed figure, the head within the
 * recommended one.
 *
 * No RPC: endorsing moves no stock, so there is no balance change to keep in
 * the same transaction as the status change.
 */
export async function endorseRequest(
  requestId: string,
  lines: { request_item_id: string; quantity_endorsed: number }[],
  remarks?: string
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("request.endorse")

    const { data: request, error: readError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("id, status, office_id, fiscal_year")
      .eq("id", requestId)
      .maybeSingle()

    if (readError) return { error: readError.message, data: null }
    if (!request) return { error: "Request not found.", data: null }
    if (request.status !== "awaiting_endorsement") {
      return {
        error: "Only requests awaiting endorsement can be endorsed.",
        data: null,
      }
    }
    if (!canActForOffice(ctx, request.office_id as string)) {
      return {
        error: "You can only endorse requests from your own office.",
        data: null,
      }
    }

    const { data: requestLines, error: linesError } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_items")
      .select("id, item_id, quantity_requested, item:items(name)")
      .eq("request_id", requestId)

    if (linesError) return { error: linesError.message, data: null }

    const byLineId = new Map(
      ((requestLines ?? []) as unknown as {
        id: string
        item_id: string
        quantity_requested: number
        item: { name: string } | null
      }[]).map((l) => [l.id, l])
    )

    // Every line, every time — an omitted one would silently keep the filed
    // quantity while the endorsement claims to cover the whole slip.
    const submitted = new Set(lines.map((l) => l.request_item_id))
    if (submitted.size !== byLineId.size) {
      return {
        error: "Endorse a quantity for every item on this request.",
        data: null,
      }
    }

    for (const line of lines) {
      if (!byLineId.has(line.request_item_id)) {
        return { error: "That item is not on this request.", data: null }
      }
      if (line.quantity_endorsed < 0) {
        return { error: "Endorsed quantity cannot be negative.", data: null }
      }
    }

    const endorsed = lines
      .filter((l) => l.quantity_endorsed > 0)
      .map((l) => ({
        item_id: byLineId.get(l.request_item_id)?.item_id ?? "",
        quantity: l.quantity_endorsed,
      }))
      .filter((l) => l.item_id)

    // Zeroing every line endorses nothing at all. Whatever that is, it is not
    // a slip GSO should be asked to fill — rejecting says so on the record.
    if (endorsed.length === 0) {
      return {
        error:
          "Endorse at least one item, or reject the request if none of it should go to GSO.",
        data: null,
      }
    }

    // The same check `createRequest` ran, re-run because the head may have
    // raised a line and because the balance can have moved since filing.
    const [availability, { data: settings }] = await Promise.all([
      loadAvailability(
        ctx,
        request.office_id as string,
        endorsed.map((l) => l.item_id),
        request.fiscal_year as number,
        requestId
      ),
      getSystemSettings(),
    ])
    const problem = checkAgainstAvailability(
      endorsed,
      availability,
      request.fiscal_year as number,
      settings.allow_over_release
    )
    if (problem) return { error: problem, data: null }

    for (const line of lines) {
      const { error } = await ctx.supabase
        .schema(SCHEMA)
        .from("request_items")
        .update({ quantity_endorsed: line.quantity_endorsed })
        .eq("id", line.request_item_id)
        .eq("request_id", requestId)

      if (error) return { error: error.message, data: null }
    }

    // Lines first, then the transition — a failure between the two leaves the
    // slip with the head, where they can simply endorse it again.
    //
    // The status predicate makes this a no-op if a second head got there
    // first, rather than stamping a second endorsement over the first.
    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .update({
        status: "pending",
        endorsed_by: ctx.userId,
        endorsed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "awaiting_endorsement")

    if (error) return { error: error.message, data: null }

    await ctx.supabase.schema(SCHEMA).from("request_logs").insert({
      request_id: requestId,
      stage: "pending",
      action: "endorsed",
      actor_id: ctx.userId,
      remarks: remarks?.trim() || null,
    })

    revalidatePath(`/dashboard/requests/${requestId}`)
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * The GSO checker's pass over an endorsed request: what GSO can actually
 * grant, line by line, and then upward to the head.
 *
 * **Cutting only.** A recommendation above the endorsed quantity is refused
 * here and by a CHECK constraint on the column — the checker's job is to bring
 * a slip down to what GSO can meet, and a stage that could inflate a request
 * would need its own approval to be worth anything. The ceiling is the
 * *endorsed* figure, not the filed one: raising a line is the department
 * head's call, and it is already made by the time this runs.
 *
 * The quantities are checked against the same availability the approval will
 * check, excluding this request's own claim. Recommending numbers the head
 * cannot then approve would move the failure one desk further from the person
 * who can still fix it.
 *
 * No RPC: recommending moves no stock, so there is no balance change to keep
 * in the same transaction — same reasoning as `endorseRequest`.
 */
export async function recommendRequest(
  requestId: string,
  lines: { request_item_id: string; quantity_recommended: number }[],
  remarks?: string
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("request.recommend")

    const { data: request, error: readError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("id, status, office_id, fiscal_year")
      .eq("id", requestId)
      .maybeSingle()

    if (readError) return { error: readError.message, data: null }
    if (!request) return { error: "Request not found.", data: null }
    if (request.status !== "pending") {
      return {
        error:
          request.status === "awaiting_endorsement"
            ? "This request is still waiting for its department head's endorsement."
            : "Only requests on GSO's review desk can be recommended.",
        data: null,
      }
    }

    // The error matters here: an empty read would otherwise be indistinguishable
    // from a request with no lines, and the "recommend every item" refusal below
    // would blame the checker for a failed query.
    const { data: requestLines, error: linesError } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_items")
      .select(
        "id, item_id, quantity_requested, quantity_endorsed, item:items(name)"
      )
      .eq("request_id", requestId)

    if (linesError) return { error: linesError.message, data: null }

    const byLineId = new Map(
      ((requestLines ?? []) as unknown as {
        id: string
        item_id: string
        quantity_requested: number
        quantity_endorsed: number | null
        item: { name: string } | null
      }[]).map((l) => [l.id, l])
    )

    // Every line, every time. Letting an omitted line stand for "grant it in
    // full" would make a slip the checker never finished look like one they
    // approved of.
    const submitted = new Set(lines.map((l) => l.request_item_id))
    if (submitted.size !== byLineId.size) {
      return {
        error: "Recommend a quantity for every item on this request.",
        data: null,
      }
    }

    for (const line of lines) {
      const item = byLineId.get(line.request_item_id)
      if (!item) {
        return { error: "That item is not on this request.", data: null }
      }
      if (line.quantity_recommended < 0) {
        return { error: "Recommended quantity cannot be negative.", data: null }
      }
      // Null on requests endorsed before migration 17 — there the filed figure
      // is what the head signed off on.
      const ceiling = Number(item.quantity_endorsed ?? item.quantity_requested)
      if (line.quantity_recommended > ceiling) {
        return {
          error: `${item.item?.name ?? "This item"}: you can only reduce an endorsed quantity — ${ceiling.toLocaleString()} was endorsed.`,
          data: null,
        }
      }
    }

    const claimed = lines
      .filter((l) => l.quantity_recommended > 0)
      .map((l) => ({
        item_id: byLineId.get(l.request_item_id)?.item_id ?? "",
        quantity: l.quantity_recommended,
      }))
      .filter((l) => l.item_id)

    const [availability, { data: settings }] = await Promise.all([
      loadAvailability(
        ctx,
        request.office_id as string,
        claimed.map((l) => l.item_id),
        request.fiscal_year as number,
        requestId
      ),
      getSystemSettings(),
    ])
    const problem = checkAgainstAvailability(
      claimed,
      availability,
      request.fiscal_year as number,
      settings.allow_over_release
    )
    if (problem) return { error: problem, data: null }

    for (const line of lines) {
      const { error } = await ctx.supabase
        .schema(SCHEMA)
        .from("request_items")
        .update({ quantity_recommended: line.quantity_recommended })
        .eq("id", line.request_item_id)
        .eq("request_id", requestId)

      if (error) return { error: error.message, data: null }
    }

    // Lines first, then the transition: a failure between the two leaves the
    // request on the checker's desk with numbers they can simply write again,
    // which is the harmless way round. The status predicate keeps the
    // transition itself single-authored if two checkers open the same slip.
    const { error: updateError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .update({
        status: "recommended",
        recommended_by: ctx.userId,
        recommended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending")

    if (updateError) return { error: updateError.message, data: null }

    await ctx.supabase.schema(SCHEMA).from("request_logs").insert({
      request_id: requestId,
      stage: "recommended",
      action: "recommended",
      actor_id: ctx.userId,
      remarks: remarks?.trim() || null,
    })

    revalidatePath(`/dashboard/requests/${requestId}`)
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * Approve a recommended request. `approvals` maps request_item id → approved
 * quantity, letting the head cut further than the checker did.
 *
 * **Only from `recommended`.** The head cannot approve a slip nobody has
 * checked: `pending` carries no recommended quantities, so there is nothing
 * for an approval to be an approval *of*. That gate is the whole reason the
 * status exists — and the reason it is a status rather than a flag is that
 * this single predicate is all it takes to enforce.
 *
 * The ceiling is the recommendation, not the request. Granting more than was
 * recommended would make the check advisory, and a CHECK constraint on the
 * column refuses it too.
 */
export async function approveRequest(
  requestId: string,
  approvals: { request_item_id: string; quantity_approved: number }[],
  remarks?: string
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("request.approve")

    const { data: request, error: readError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("id, status, office_id, fiscal_year")
      .eq("id", requestId)
      .maybeSingle()

    if (readError) return { error: readError.message, data: null }
    if (!request) return { error: "Request not found.", data: null }
    if (request.status !== "recommended") {
      return {
        error:
          request.status === "awaiting_endorsement"
            ? "This request is still waiting for its department head's endorsement."
            : request.status === "pending"
            ? "This request has not been checked yet. A GSO checker sets the quantities and recommends it before it can be approved."
            : "Only recommended requests can be approved.",
        data: null,
      }
    }

    for (const line of approvals) {
      if (line.quantity_approved < 0) {
        return { error: "Approved quantity cannot be negative.", data: null }
      }
    }

    // Approving is a promise the counter has to keep, so check the quantities
    // against what is left after other approved-but-uncollected requests.
    //
    // These rows carry the recommendation, i.e. the ceiling — so a failed read
    // has to abort rather than fall through to an unchecked approval.
    const { data: requestLines, error: linesError } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_items")
      .select(
        "id, item_id, quantity_requested, quantity_recommended, item:items(name)"
      )
      .eq("request_id", requestId)

    if (linesError) return { error: linesError.message, data: null }

    const byLineId = new Map(
      ((requestLines ?? []) as unknown as {
        id: string
        item_id: string
        quantity_requested: number
        quantity_recommended: number | null
        item: { name: string } | null
      }[]).map((l) => [l.id, l])
    )

    for (const line of approvals) {
      const item = byLineId.get(line.request_item_id)
      if (!item) {
        return { error: "That item is not on this request.", data: null }
      }
      // A null recommendation on a recommended request means the checker's
      // write was interrupted; falling back to the requested quantity would
      // quietly hand back the cut they were in the middle of making.
      const ceiling = item.quantity_recommended
      if (ceiling === null) {
        return {
          error:
            "This request is missing its recommended quantities. Ask the GSO checker to recommend it again.",
          data: null,
        }
      }
      if (line.quantity_approved > Number(ceiling)) {
        return {
          error: `${item.item?.name ?? "This item"}: ${Number(
            ceiling
          ).toLocaleString()} was recommended, so no more than that can be approved.`,
          data: null,
        }
      }
    }

    const itemByLineId = new Map(
      [...byLineId.values()].map((l) => [l.id, l.item_id])
    )
    const approvedLines = approvals
      .filter((a) => a.quantity_approved > 0)
      .map((a) => ({
        item_id: itemByLineId.get(a.request_item_id) ?? "",
        quantity: a.quantity_approved,
      }))
      .filter((a) => a.item_id)

    const [availability, { data: settings }] = await Promise.all([
      loadAvailability(
        ctx,
        request.office_id as string,
        approvedLines.map((a) => a.item_id),
        request.fiscal_year as number,
        requestId
      ),
      getSystemSettings(),
    ])
    const problem = checkAgainstAvailability(
      approvedLines,
      availability,
      request.fiscal_year as number,
      settings.allow_over_release
    )
    if (problem) return { error: problem, data: null }

    for (const line of approvals) {
      const { error } = await ctx.supabase
        .schema(SCHEMA)
        .from("request_items")
        .update({ quantity_approved: line.quantity_approved })
        .eq("id", line.request_item_id)
        .eq("request_id", requestId)

      if (error) return { error: error.message, data: null }
    }

    const { error: updateError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .update({
        status: "approved",
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)

    if (updateError) return { error: updateError.message, data: null }

    await ctx.supabase.schema(SCHEMA).from("request_logs").insert({
      request_id: requestId,
      stage: "approved",
      action: "approved",
      actor_id: ctx.userId,
      remarks: remarks ?? null,
    })

    revalidatePath(`/dashboard/requests/${requestId}`)
    revalidatePath("/dashboard/requests")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * Reject a request. Two different people can do this at two different stages:
 * the requesting office's own department head before it reaches GSO, and GSO
 * afterwards. Rejection is terminal either way — there is no edit-and-resubmit
 * flow, so a corrected slip is filed as a new request.
 */
export async function rejectRequest(
  requestId: string,
  remarks: string
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("request.approve", "request.endorse")

    if (!remarks?.trim()) {
      return { error: "A reason is required when rejecting a request.", data: null }
    }

    const { data: request } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("id, status, office_id")
      .eq("id", requestId)
      .maybeSingle()

    if (!request) return { error: "Request not found.", data: null }

    // Which stage it is in decides who may reject it. Holding `request.endorse`
    // never lets someone reject at GSO's stage, and vice versa.
    if (request.status === "awaiting_endorsement") {
      if (!ctx.permissions.includes("request.endorse")) {
        return {
          error:
            "This request has not been endorsed by its department head yet.",
          data: null,
        }
      }
      if (!canActForOffice(ctx, request.office_id as string)) {
        return {
          error: "You can only reject requests from your own office.",
          data: null,
        }
      }
    } else if (["pending", "recommended", "approved"].includes(request.status)) {
      if (!ctx.permissions.includes("request.approve")) {
        return {
          error: "You do not have permission to reject this request.",
          data: null,
        }
      }
    } else {
      return {
        error:
          "Only requests that have not been released yet can be rejected.",
        data: null,
      }
    }

    // The department head's rejection is an endorsement decision, not a GSO
    // review, so it stamps `endorsed_*` rather than `reviewed_*`.
    const isEndorsementStage = request.status === "awaiting_endorsement"
    const now = new Date().toISOString()

    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .update({
        status: "rejected",
        ...(isEndorsementStage
          ? { endorsed_by: ctx.userId, endorsed_at: now }
          : { reviewed_by: ctx.userId, reviewed_at: now }),
        updated_at: now,
      })
      .eq("id", requestId)

    if (error) return { error: error.message, data: null }

    await ctx.supabase.schema(SCHEMA).from("request_logs").insert({
      request_id: requestId,
      stage: "rejected",
      action: "rejected",
      actor_id: ctx.userId,
      remarks: remarks.trim(),
    })

    revalidatePath(`/dashboard/requests/${requestId}`)
    revalidatePath("/dashboard/requests")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

export async function cancelRequest(
  requestId: string,
  remarks: string
): Promise<ActionResult> {
  try {
    const ctx = await requireSession()

    // Terminal, and there is no edit-and-resubmit flow — the reason is the only
    // record of why the slip stopped, exactly as it is for a rejection.
    if (!remarks?.trim()) {
      return {
        error: "A reason is required when cancelling a request.",
        data: null,
      }
    }

    const { data: request } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("id, status, office_id, requested_by")
      .eq("id", requestId)
      .maybeSingle()

    if (!request) return { error: "Request not found.", data: null }
    // Withdrawable right up to approval — including while it sits with the
    // department head, which is where a slip filed in error is usually caught,
    // and while GSO is checking it. Nothing is committed until approval.
    if (
      !["awaiting_endorsement", "pending", "recommended"].includes(
        request.status
      )
    ) {
      return {
        error: "Only requests that have not been approved can be cancelled.",
        data: null,
      }
    }

    const isOwner =
      request.requested_by === ctx.userId ||
      ctx.officeIds.includes(request.office_id as string)
    const canReview =
      ctx.permissions.includes("request.approve") ||
      ctx.permissions.includes("request.endorse")
    if (!isOwner && !canReview) {
      return { error: "You cannot cancel this request.", data: null }
    }

    // `canReview` is unscoped by office, which was fine while GSO could see
    // every slip. It no longer can: withdrawing another department's request
    // before they have even endorsed it is not a decision a GSO desk that
    // cannot see the request should be making.
    if (
      !canViewRequest(requestVisibility(ctx), {
        office_id: request.office_id as string,
        status: request.status as RequestStatus,
      })
    ) {
      return { error: REQUEST_NOT_VISIBLE, data: null }
    }

    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", requestId)

    if (error) return { error: error.message, data: null }

    await ctx.supabase.schema(SCHEMA).from("request_logs").insert({
      request_id: requestId,
      stage: "cancelled",
      action: "cancelled",
      actor_id: ctx.userId,
      remarks: remarks.trim(),
    })

    revalidatePath(`/dashboard/requests/${requestId}`)
    revalidatePath("/dashboard/requests")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * Record the physical release. Delegates to the `release_request` RPC so the
 * release header, its lines, the balance deduction, the ledger rows, and the
 * status transition all happen in one transaction — a partial failure can
 * never leave stock half-deducted, nor a receipt for goods that never moved.
 *
 * `receivedBy` is required rather than optional: it is one half of the
 * two-party record, and a release with nobody named on the receiving end
 * leaves the acknowledgement below with nobody to point at. The RPC refuses it
 * too — this check only spares a round trip and phrases it better.
 */
export async function releaseRequest(
  requestId: string,
  lines: { request_item_id: string; quantity: number }[],
  receivedBy: string,
  remarks?: string
): Promise<ActionResult<{ status: string } | null>> {
  try {
    const ctx = await requirePermission("request.release")

    const payload = lines.filter((l) => l.quantity > 0)
    if (payload.length === 0) {
      return { error: "Enter at least one quantity to release.", data: null }
    }
    if (!receivedBy?.trim()) {
      return {
        error: "Name the person collecting the supplies.",
        data: null,
      }
    }

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .rpc("release_request", {
        p_request_id: requestId,
        p_actor_id: ctx.userId,
        p_lines: payload,
        p_received_by: receivedBy.trim(),
        p_remarks: remarks ?? null,
      })

    if (error) return { error: error.message, data: null }

    revalidatePath(`/dashboard/requests/${requestId}`)
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard/inventory")
    revalidatePath("/dashboard/movements")
    revalidatePath("/dashboard")
    return { error: null, data: { status: data as string } }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * The requesting office's counter-signature on one release.
 *
 * Send no `lines` to confirm everything exactly as issued; send every line
 * with `dispute` to report what actually arrived. A dispute deliberately moves
 * no stock — it records the office's count and flags the release for GSO, who
 * reconciles the balance with `adjust_stock`. That keeps the ledger with one
 * author, so a shortfall surfaces as a visible correction rather than as a
 * department quietly editing inventory.
 *
 * The rules that matter are enforced in the RPC, not here: the acknowledger
 * cannot be the person who released, and must belong to the receiving office.
 */
export async function acknowledgeRelease(
  input: unknown
): Promise<ActionResult<{ ackStatus: string } | null>> {
  try {
    const ctx = await requirePermission("request.acknowledge")
    const parsed = acknowledgeReleaseSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, data: null }
    }
    const values = parsed.data

    // The request id is only needed to revalidate its page, and the RPC
    // resolves the release on its own — so a bad id here cannot widen access.
    const { data: release } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_releases")
      .select("request_id")
      .eq("id", values.release_id)
      .maybeSingle()

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .rpc("acknowledge_release", {
        p_release_id: values.release_id,
        p_actor_id: ctx.userId,
        p_lines: values.lines ?? null,
        p_remarks: values.remarks ?? null,
        p_dispute: values.dispute,
      })

    if (error) return { error: error.message, data: null }

    if (release?.request_id) {
      revalidatePath(`/dashboard/requests/${release.request_id}`)
    }
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard")
    return { error: null, data: { ackStatus: data as string } }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * GSO's answer to a reported discrepancy.
 *
 * `ack_status` deliberately stays `disputed`: the dispute happened, and
 * clearing it would erase the record this whole feature exists to keep. What
 * this writes is that it has been dealt with, and by whom — which is what takes
 * it off GSO's queue.
 *
 * Moves no stock either. If the balance needs correcting, that is a stock
 * adjustment, made deliberately and visible in the ledger on its own terms.
 *
 * No RPC: one row and one log entry, with no balance to keep in the same
 * transaction — same reasoning as `endorseRequest`.
 */
export async function resolveReleaseDispute(
  releaseId: string,
  resolution: string
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("request.release")

    if (!resolution?.trim()) {
      return {
        error: "Record how the discrepancy was settled.",
        data: null,
      }
    }

    const { data: release, error: readError } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_releases")
      .select("id, request_id, ack_status, dispute_resolved_at")
      .eq("id", releaseId)
      .maybeSingle()

    if (readError) return { error: readError.message, data: null }
    if (!release) return { error: "Release not found.", data: null }
    if (release.ack_status !== "disputed") {
      return {
        error: "Only a reported discrepancy can be resolved.",
        data: null,
      }
    }
    if (release.dispute_resolved_at) {
      return { error: "This discrepancy has already been resolved.", data: null }
    }

    const { data: request } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("status")
      .eq("id", release.request_id as string)
      .maybeSingle()

    // The predicate makes this a no-op if someone else got there first, rather
    // than stamping a second resolution over the first.
    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_releases")
      .update({
        dispute_resolved_by: ctx.userId,
        dispute_resolved_at: new Date().toISOString(),
        dispute_resolution: resolution.trim(),
      })
      .eq("id", releaseId)
      .is("dispute_resolved_at", null)

    if (error) return { error: error.message, data: null }

    await ctx.supabase.schema(SCHEMA).from("request_logs").insert({
      request_id: release.request_id,
      stage: request?.status ?? "released",
      action: "resolved",
      actor_id: ctx.userId,
      remarks: resolution.trim(),
    })

    revalidatePath(`/dashboard/requests/${release.request_id}`)
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * Take back a released line the warehouse never actually handed over.
 *
 * The case this exists for: GSO approves a slip, the custodian records the
 * release, the office signs for it — and one of the items turns out not to have
 * been on the shelf. Nothing about the request was wrong; the claim that it was
 * issued was. Before this the only remedy was a bare `adjust_stock`, which put
 * the balance right and left the issuance reports counting goods that never
 * moved, the slip reading `released`, and the correction tied to the request by
 * nothing but a line of free text.
 *
 * Everything that makes it a correction rather than an erasure lives in
 * `void_release_item`, in one transaction: the balance goes back to the office
 * it was drawn from, `quantity_released` comes down so the slip is releasable
 * again when the stock arrives, a `void` ledger row is written carrying both
 * the request and the release, and a `voided` entry lands on the timeline. The
 * original `release` row and the office's acknowledgement are left exactly as
 * written — what the office signed is what it believed at the time.
 *
 * `request.void_release` rather than `request.release`: recording an issuance
 * and unrecording one are different powers, and an LGU that wants the second
 * one held only by the GSO head should get that by revoking a role permission
 * rather than by anyone editing this file.
 */
export async function voidReleaseItem(
  input: unknown
): Promise<ActionResult<{ status: string } | null>> {
  try {
    const ctx = await requirePermission("request.void_release")
    const parsed = voidReleaseItemSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, data: null }
    }
    const values = parsed.data

    // Only to revalidate the right page afterwards. The RPC resolves the
    // release line, the request and the office on its own, so a wrong id here
    // fails there rather than reaching anything it should not.
    const { data: line } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_release_items")
      .select("release:request_releases!release_id(request_id)")
      .eq("id", values.release_item_id)
      .maybeSingle()

    const requestId = (
      line as { release?: { request_id?: string } | null } | null
    )?.release?.request_id

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .rpc("void_release_item", {
        p_release_item_id: values.release_item_id,
        p_actor_id: ctx.userId,
        p_quantity: values.quantity,
        p_reason: values.reason,
      })

    if (error) return { error: error.message, data: null }

    if (requestId) revalidatePath(`/dashboard/requests/${requestId}`)
    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard/inventory")
    revalidatePath("/dashboard/movements")
    revalidatePath("/dashboard/reports")
    revalidatePath("/dashboard")
    return { error: null, data: { status: data as string } }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}
