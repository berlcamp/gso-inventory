"use server"

import { requireSession, toError, SCHEMA } from "@/lib/auth/session"
import { getSystemSettings } from "@/lib/actions/settings"
import type { ActionResult, RequestLogRow, RequestStatus } from "@/types/database"

export interface DashboardStats {
  /** Filed, still with the requesting office's department head. */
  awaitingEndorsement: number
  /** Endorsed and on GSO's desk. */
  pendingRequests: number
  awaitingRelease: number
  /** Handed over but not yet signed for by the office that received it. */
  awaitingConfirmation: number
  /** Signed for with quantities that did not match, and not yet settled. */
  openDiscrepancies: number
  releasedThisMonth: number
  unitsIssuedThisMonth: number
  lowStockItems: number
  /** Present only for GSO-side users — supply officers see their own office. */
  scopeLabel: string
}

export interface PipelineItem {
  status: RequestStatus
  count: number
}

export interface TopItem {
  item_id: string
  name: string
  unit: string
  quantity: number
}

export interface LowStockEntry {
  office_id: string
  office_name: string
  office_code: string
  item_id: string
  item_name: string
  unit: string
  quantity: number
}

const PIPELINE_STATUSES: RequestStatus[] = [
  "awaiting_endorsement",
  "pending",
  "approved",
  "partially_released",
  "released",
]

function startOfMonthISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

export async function getDashboardStats(): Promise<
  ActionResult<DashboardStats | null>
> {
  try {
    const ctx = await requireSession()
    const scoped = !ctx.canViewAll ? ctx.officeIds : null
    if (scoped && scoped.length === 0) {
      return { error: "No office is assigned to your account.", data: null }
    }

    const monthStart = startOfMonthISO()
    const { data: settings } = await getSystemSettings()
    const lowThreshold = settings.low_stock_threshold

    // `pending` now means "endorsed, on GSO's desk" — the stage before it has
    // its own status, so this count needs no extra predicate to stay honest.
    let endorsementQuery = ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "awaiting_endorsement")

    let pendingQuery = ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")

    let awaitingQuery = ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("*", { count: "exact", head: true })
      .in("status", ["approved", "partially_released"])

    // Both keyed on releases rather than requests: acknowledgement is per
    // handover, so a slip released in two trips can be half signed for. `!inner`
    // makes the embed a join so the office scope below reaches the request.
    let unconfirmedQuery = ctx.supabase
      .schema(SCHEMA)
      .from("request_releases")
      .select("id, request:requests!request_id!inner(office_id)", {
        count: "exact",
        head: true,
      })
      .eq("ack_status", "pending")

    // Unresolved only — a discrepancy GSO has already settled is history, and
    // counting it forever would make the tile mean nothing.
    let discrepancyQuery = ctx.supabase
      .schema(SCHEMA)
      .from("request_releases")
      .select("id, request:requests!request_id!inner(office_id)", {
        count: "exact",
        head: true,
      })
      .eq("ack_status", "disputed")
      .is("dispute_resolved_at", null)

    let releasedQuery = ctx.supabase
      .schema(SCHEMA)
      .from("requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "released")
      .gte("released_at", monthStart)

    let issuedQuery = ctx.supabase
      .schema(SCHEMA)
      .from("stock_movements")
      .select("quantity")
      .eq("movement_type", "release")
      .gte("created_at", monthStart)

    let lowStockQuery = ctx.supabase
      .schema(SCHEMA)
      .from("office_stocks")
      .select("*", { count: "exact", head: true })
      .gt("quantity", 0)
      .lte("quantity", lowThreshold)

    if (scoped) {
      endorsementQuery = endorsementQuery.in("office_id", scoped)
      pendingQuery = pendingQuery.in("office_id", scoped)
      awaitingQuery = awaitingQuery.in("office_id", scoped)
      unconfirmedQuery = unconfirmedQuery.in("request.office_id", scoped)
      discrepancyQuery = discrepancyQuery.in("request.office_id", scoped)
      releasedQuery = releasedQuery.in("office_id", scoped)
      issuedQuery = issuedQuery.in("office_id", scoped)
      lowStockQuery = lowStockQuery.in("office_id", scoped)
    }

    const [
      endorsement,
      pending,
      awaiting,
      unconfirmed,
      discrepancies,
      releasedMonth,
      issuedMonth,
      lowStock,
    ] = await Promise.all([
      endorsementQuery,
      pendingQuery,
      awaitingQuery,
      unconfirmedQuery,
      discrepancyQuery,
      releasedQuery,
      issuedQuery,
      lowStockQuery,
    ])

    const unitsIssued = ((issuedMonth.data ?? []) as { quantity: number }[]).reduce(
      (sum, m) => sum + Math.abs(Number(m.quantity)),
      0
    )

    return {
      error: null,
      data: {
        awaitingEndorsement: endorsement.count ?? 0,
        pendingRequests: pending.count ?? 0,
        awaitingRelease: awaiting.count ?? 0,
        awaitingConfirmation: unconfirmed.count ?? 0,
        openDiscrepancies: discrepancies.count ?? 0,
        releasedThisMonth: releasedMonth.count ?? 0,
        unitsIssuedThisMonth: unitsIssued,
        lowStockItems: lowStock.count ?? 0,
        scopeLabel: !scoped
          ? "All offices"
          : scoped.length > 1
          ? `Your ${scoped.length} offices`
          : "Your office",
      },
    }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

export async function getPipelineCounts(): Promise<ActionResult<PipelineItem[]>> {
  try {
    const ctx = await requireSession()
    const scoped = !ctx.canViewAll ? ctx.officeIds : null

    const results = await Promise.all(
      PIPELINE_STATUSES.map((status) => {
        const q = ctx.supabase
          .schema(SCHEMA)
          .from("requests")
          .select("*", { count: "exact", head: true })
          .eq("status", status)
        return scoped ? q.in("office_id", scoped) : q
      })
    )

    return {
      error: null,
      data: PIPELINE_STATUSES.map((status, i) => ({
        status,
        count: results[i].count ?? 0,
      })),
    }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function getRecentActivity(
  limit = 10
): Promise<ActionResult<RequestLogRow[]>> {
  try {
    const ctx = await requireSession()

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("request_logs")
      .select(
        "*, actor:user_profiles!actor_id(id, full_name), request:requests!request_id(id, request_no, office_id, office:offices!office_id(id, name, code))"
      )
      .order("created_at", { ascending: false })
      .limit(ctx.canViewAll ? limit : limit * 4)

    if (error) return { error: error.message, data: [] }

    let rows = (data ?? []) as unknown as (RequestLogRow & {
      request?: { office_id?: string } | null
    })[]

    // Supply officers only see activity on their own offices' requests.
    if (!ctx.canViewAll) {
      rows = rows
        .filter((r) =>
          r.request?.office_id
            ? ctx.officeIds.includes(r.request.office_id)
            : false
        )
        .slice(0, limit)
    }

    return { error: null, data: rows as RequestLogRow[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

/** Most-issued items over the trailing 30 days. */
export async function getTopIssuedItems(
  limit = 8
): Promise<ActionResult<TopItem[]>> {
  try {
    const ctx = await requireSession()
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    let query = ctx.supabase
      .schema(SCHEMA)
      .from("stock_movements")
      .select("item_id, quantity, item:items!item_id(id, name, unit:units(code))")
      .eq("movement_type", "release")
      .gte("created_at", since)

    if (!ctx.canViewAll) {
      if (ctx.officeIds.length === 0) return { error: null, data: [] }
      query = query.in("office_id", ctx.officeIds)
    }

    const { data, error } = await query
    if (error) return { error: error.message, data: [] }

    const totals = new Map<string, TopItem>()
    for (const row of (data ?? []) as unknown as {
      item_id: string
      quantity: number
      item: { name: string; unit: { code: string } | null } | null
    }[]) {
      const key = row.item_id
      const current = totals.get(key) ?? {
        item_id: key,
        name: row.item?.name ?? "—",
        unit: row.item?.unit?.code ?? "",
        quantity: 0,
      }
      current.quantity += Math.abs(Number(row.quantity))
      totals.set(key, current)
    }

    return {
      error: null,
      data: [...totals.values()]
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit),
    }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function getLowStock(limit = 10): Promise<ActionResult<LowStockEntry[]>> {
  try {
    const ctx = await requireSession()
    const { data: settings } = await getSystemSettings()

    let query = ctx.supabase
      .schema(SCHEMA)
      .from("office_stocks")
      .select(
        "office_id, item_id, quantity, office:offices!office_id(id, name, code), item:items!item_id(id, name, unit:units(code))"
      )
      .gt("quantity", 0)
      .lte("quantity", settings.low_stock_threshold)
      .order("quantity", { ascending: true })
      .limit(limit)

    if (!ctx.canViewAll) {
      if (ctx.officeIds.length === 0) return { error: null, data: [] }
      query = query.in("office_id", ctx.officeIds)
    }

    const { data, error } = await query
    if (error) return { error: error.message, data: [] }

    return {
      error: null,
      data: (data ?? []).map((r: unknown) => {
        const row = r as {
          office_id: string
          item_id: string
          quantity: number
          office: { name: string; code: string } | null
          item: { name: string; unit: { code: string } | null } | null
        }
        return {
          office_id: row.office_id,
          office_name: row.office?.name ?? "—",
          office_code: row.office?.code ?? "",
          item_id: row.item_id,
          item_name: row.item?.name ?? "—",
          unit: row.item?.unit?.code ?? "",
          quantity: Number(row.quantity),
        }
      }),
    }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}
