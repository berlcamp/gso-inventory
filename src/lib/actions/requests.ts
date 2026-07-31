"use server"

import { revalidatePath } from "next/cache"
import {
  requireSession,
  requirePermission,
  toError,
  SCHEMA,
} from "@/lib/auth/session"
import {
  supplyRequestSchema,
  walkInReleaseSchema,
} from "@/lib/schemas/gso"
import type {
  ActionResult,
  RequestLogRow,
  RequestStatus,
  SupplyRequestRow,
} from "@/types/database"

const REQUEST_SELECT = `
  *,
  office:offices!office_id(id, name, code),
  requester:user_profiles!requested_by(id, full_name, email),
  reviewer:user_profiles!reviewed_by(id, full_name),
  releaser:user_profiles!released_by(id, full_name)
`

const REQUEST_DETAIL_SELECT = `
  *,
  office:offices!office_id(id, name, code),
  requester:user_profiles!requested_by(id, full_name, email),
  reviewer:user_profiles!reviewed_by(id, full_name),
  releaser:user_profiles!released_by(id, full_name),
  request_items(
    *,
    item:items(*, category:categories(id, name), unit:units(id, code, name))
  )
`

/* ── Reads ─────────────────────────────────────────────────────────────── */

export async function getRequests(params: {
  status?: string
  officeId?: string
  search?: string
  page?: number
  pageSize?: number
}): Promise<ActionResult<{ rows: SupplyRequestRow[]; count: number }>> {
  try {
    const ctx = await requireSession()
    const page = Math.max(1, params.page ?? 1)
    const pageSize = params.pageSize ?? 20

    let query = ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select(REQUEST_SELECT, { count: "exact" })
      .order("requested_at", { ascending: false })

    // Supply officers only ever see their own office's requests.
    if (!ctx.canViewAll) {
      if (!ctx.profile.office_id) {
        return { error: null, data: { rows: [], count: 0 } }
      }
      query = query.eq("office_id", ctx.profile.office_id)
    } else if (params.officeId) {
      query = query.eq("office_id", params.officeId)
    }

    if (params.status && params.status !== "all") {
      query = query.eq("status", params.status as RequestStatus)
    }

    if (params.search?.trim()) {
      const term = params.search.trim()
      query = query.or(
        `request_no.ilike.%${term}%,purpose.ilike.%${term}%,requester_name.ilike.%${term}%`
      )
    }

    const from = (page - 1) * pageSize
    query = query.range(from, from + pageSize - 1)

    const { data, count, error } = await query
    if (error) return { error: error.message, data: { rows: [], count: 0 } }

    return {
      error: null,
      data: {
        rows: (data ?? []) as unknown as SupplyRequestRow[],
        count: count ?? 0,
      },
    }
  } catch (e) {
    return { error: toError(e), data: { rows: [], count: 0 } }
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
 * Current remaining balances for the given office, keyed by item id.
 * Drives the "available" column when building or approving a request.
 */
export async function getOfficeBalances(
  officeId: string
): Promise<ActionResult<Record<string, number>>> {
  try {
    const ctx = await requireSession()

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("office_stocks")
      .select("item_id, quantity")
      .eq("office_id", officeId)

    if (error) return { error: error.message, data: {} }

    const map: Record<string, number> = {}
    for (const row of (data ?? []) as { item_id: string; quantity: number }[]) {
      map[row.item_id] = Number(row.quantity)
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

    const { data: created, error: insertError } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .insert({
        office_id: values.office_id,
        requested_by: ctx.userId,
        requester_name: ctx.profile.full_name,
        source: "system",
        status: "pending",
        purpose: values.purpose,
        remarks: values.remarks ?? null,
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
      stage: "pending",
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
 * Approve a pending request. `approvals` maps request_item id → approved
 * quantity, letting GSO trim what the office asked for.
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
      .select("id, status")
      .eq("id", requestId)
      .maybeSingle()

    if (readError) return { error: readError.message, data: null }
    if (!request) return { error: "Request not found.", data: null }
    if (request.status !== "pending") {
      return { error: `Only pending requests can be approved.`, data: null }
    }

    for (const line of approvals) {
      if (line.quantity_approved < 0) {
        return { error: "Approved quantity cannot be negative.", data: null }
      }
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

export async function rejectRequest(
  requestId: string,
  remarks: string
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("request.approve")

    if (!remarks?.trim()) {
      return { error: "A reason is required when rejecting a request.", data: null }
    }

    const { data: request } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("id, status")
      .eq("id", requestId)
      .maybeSingle()

    if (!request) return { error: "Request not found.", data: null }
    if (!["pending", "approved"].includes(request.status)) {
      return {
        error: "Only pending or approved requests can be rejected.",
        data: null,
      }
    }

    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .update({
        status: "rejected",
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
    if (request.status !== "pending") {
      return { error: "Only pending requests can be cancelled.", data: null }
    }

    const isOwner =
      request.requested_by === ctx.userId ||
      request.office_id === ctx.profile.office_id
    if (!isOwner && !ctx.permissions.includes("request.approve")) {
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
