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
  supplyRequestSchema,
} from "@/lib/schemas/gso"
import { getSystemSettings } from "@/lib/actions/settings"
import {
  checkAgainstAvailability,
  loadAvailability,
} from "@/lib/inventory/availability"
import type {
  ActionResult,
  ItemAvailability,
  RequestLogRow,
  RequestReleaseRow,
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
  reviewer:user_profiles!reviewed_by(id, full_name),
  releaser:user_profiles!released_by(id, full_name),
  request_releases(id, ack_status)
`

const REQUEST_DETAIL_SELECT = `
  *,
  office:offices!office_id(id, name, code),
  requester:user_profiles!requested_by(id, full_name, email),
  endorser:user_profiles!endorsed_by(id, full_name),
  reviewer:user_profiles!reviewed_by(id, full_name),
  releaser:user_profiles!released_by(id, full_name),
  request_items(
    *,
    item:items(*, category:categories(id, name), unit:units(id, code, name))
  )
`

/* ── Department head helpers ───────────────────────────────────────────── */

/**
 * A department head acts on their **own** offices only, exactly as a supply
 * officer is scoped to theirs. `request.view_all` holders (admin, GSO) are
 * deliberately unscoped so a slip is never stranded when an office's head is
 * unavailable.
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

    if (!ctx.canViewAll) {
      if (ctx.officeIds.length === 0) return { error: null, data: [] }
      query = query.in("office_id", ctx.officeIds)
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

    if (!canActForOffice(ctx, row.office_id)) {
      return { error: "You can only view your own office's requests.", data: null }
    }

    return { error: null, data: row }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

export async function getRequestLogs(
  requestId: string
): Promise<ActionResult<RequestLogRow[]>> {
  try {
    const ctx = await requireSession()

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
      .select("office_id")
      .eq("id", requestId)
      .maybeSingle()

    if (!request) return { error: "Request not found.", data: [] }
    if (!canActForOffice(ctx, request.office_id as string)) {
      return {
        error: "You can only view your own office's requests.",
        data: [],
      }
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
      .select("office_id, fiscal_year, request_items(item_id)")
      .eq("id", requestId)
      .maybeSingle()

    if (!request) return { error: "Request not found.", data: {} }

    const row = request as unknown as {
      office_id: string
      fiscal_year: number
      request_items: { item_id: string }[] | null
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
 * Endorse a request so it reaches GSO.
 *
 * The department head is the requesting office's own second signature: they
 * send the slip on as filed, or reject it with a reason. Quantities are
 * deliberately untouched — trimming stays GSO's job at approval, so there is
 * exactly one place where approved quantities are decided.
 *
 * No RPC: endorsing moves no stock, so there is no balance change to keep in
 * the same transaction as the status change.
 */
export async function endorseRequest(
  requestId: string,
  remarks?: string
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("request.endorse")

    const { data: request, error: readError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("id, status, office_id")
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
 * Approve a pending request. `approvals` maps request_item id → approved
 * quantity, letting GSO trim what the office asked for.
 *
 * `pending` means endorsed by the department head, so this needs no extra
 * check — a request that has not cleared the office is not in this status.
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
    if (request.status !== "pending") {
      return {
        error:
          request.status === "awaiting_endorsement"
            ? "This request is still waiting for its department head's endorsement."
            : "Only pending requests can be approved.",
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
    const { data: requestLines } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_items")
      .select("id, item_id")
      .eq("request_id", requestId)

    const itemByLineId = new Map(
      ((requestLines ?? []) as { id: string; item_id: string }[]).map((l) => [
        l.id,
        l.item_id,
      ])
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
    } else if (["pending", "approved"].includes(request.status)) {
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
    // department head, which is where a slip filed in error is usually caught.
    if (!["awaiting_endorsement", "pending"].includes(request.status)) {
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
