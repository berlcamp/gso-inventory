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
  supplyRequestSchema,
  walkInReleaseSchema,
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
  SupplyRequestRow,
} from "@/types/database"

const REQUEST_SELECT = `
  *,
  office:offices!office_id(id, name, code),
  requester:user_profiles!requested_by(id, full_name, email),
  endorser:user_profiles!endorsed_by(id, full_name),
  reviewer:user_profiles!reviewed_by(id, full_name),
  releaser:user_profiles!released_by(id, full_name)
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
 * A department head acts on their own office only, exactly as a supply officer
 * is scoped to theirs. `request.view_all` holders (admin, GSO) are deliberately
 * unscoped so a slip is never stranded when an office's head is unavailable.
 *
 * Not exported: a `"use server"` module may only export async functions.
 */
function canActForOffice(ctx: SessionContext, officeId: string): boolean {
  return ctx.canViewAll || ctx.profile.office_id === officeId
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
  const { data } = await ctx.supabase
    .schema(SCHEMA)
    .from("user_profiles")
    .select("id, user_roles(role:roles(code))")
    .eq("office_id", officeId)
    .eq("is_active", true)

  const rows = (data ?? []) as unknown as {
    user_roles: { role: { code: string } | null }[] | null
  }[]

  return rows.some((profile) =>
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
      if (!ctx.profile.office_id) return { error: null, data: [] }
      query = query.eq("office_id", ctx.profile.office_id)
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

    if (!ctx.canViewAll && row.office_id !== ctx.profile.office_id) {
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

    // A supply officer may only file for their own office.
    if (
      !ctx.permissions.includes("request.view_all") &&
      values.office_id !== ctx.profile.office_id
    ) {
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
  remarks?: string
): Promise<ActionResult> {
  try {
    const ctx = await requireSession()

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
      request.office_id === ctx.profile.office_id
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
 * Record the physical release. Delegates to the `release_request` RPC so the
 * balance deduction, ledger rows, and status transition happen in one
 * transaction — a partial failure can never leave stock half-deducted.
 */
export async function releaseRequest(
  requestId: string,
  lines: { request_item_id: string; quantity: number }[],
  receivedBy?: string,
  remarks?: string
): Promise<ActionResult<{ status: string } | null>> {
  try {
    const ctx = await requirePermission("request.release")

    const payload = lines.filter((l) => l.quantity > 0)
    if (payload.length === 0) {
      return { error: "Enter at least one quantity to release.", data: null }
    }

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .rpc("release_request", {
        p_request_id: requestId,
        p_actor_id: ctx.userId,
        p_lines: payload,
        p_received_by: receivedBy ?? null,
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

/** Over-the-counter issuance: create an approved request and release it at once. */
export async function createWalkInRelease(
  input: unknown
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const ctx = await requirePermission("request.walk_in")
    const parsed = walkInReleaseSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, data: null }
    }
    const values = parsed.data

    const merged = new Map<string, number>()
    for (const line of values.lines) {
      merged.set(line.item_id, (merged.get(line.item_id) ?? 0) + line.quantity)
    }

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .rpc("create_walk_in_release", {
        p_office_id: values.office_id,
        p_actor_id: ctx.userId,
        p_requester_name: values.requester_name,
        p_purpose: values.purpose ?? null,
        p_lines: [...merged.entries()].map(([item_id, quantity]) => ({
          item_id,
          quantity,
        })),
        p_remarks: values.remarks ?? null,
      })

    if (error) return { error: error.message, data: null }

    revalidatePath("/dashboard/requests")
    revalidatePath("/dashboard/inventory")
    revalidatePath("/dashboard/movements")
    revalidatePath("/dashboard")
    return { error: null, data: { id: data as string } }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}
