"use server"

import { requirePermission, toError, SCHEMA } from "@/lib/auth/session"
import type { ActionResult, RequestStatus } from "@/types/database"

export interface OfficeIssuance {
  office_id: string
  office_name: string
  office_code: string
  units_issued: number
  transactions: number
  remaining: number
}

export interface CategoryIssuance {
  category: string
  units_issued: number
  items: number
}

export interface MonthlyTrend {
  month: number
  units_issued: number
  requests: number
}

export interface ReportFilters {
  from?: string
  to?: string
  officeId?: string
}

/** Movement rows joined with what the report tables need, honouring filters. */
async function fetchReleases(filters: ReportFilters) {
  const ctx = await requirePermission("reports.view")

  let query = ctx.supabase
    .schema(SCHEMA)
    .from("stock_movements")
    .select(
      "office_id, item_id, quantity, created_at, request_id, office:offices!office_id(id, name, code), item:items!item_id(id, name, category:categories(name), unit:units(code))"
    )
    .eq("movement_type", "release")

  if (filters.from) query = query.gte("created_at", filters.from)
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`)
  if (filters.officeId) query = query.eq("office_id", filters.officeId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return {
    ctx,
    rows: (data ?? []) as unknown as {
      office_id: string
      item_id: string
      quantity: number
      created_at: string
      request_id: string | null
      office: { id: string; name: string; code: string } | null
      item: {
        id: string
        name: string
        category: { name: string } | null
        unit: { code: string } | null
      } | null
    }[],
  }
}

export async function getIssuanceByOffice(
  filters: ReportFilters
): Promise<ActionResult<OfficeIssuance[]>> {
  try {
    const { ctx, rows } = await fetchReleases(filters)

    const totals = new Map<string, OfficeIssuance>()
    for (const row of rows) {
      const entry = totals.get(row.office_id) ?? {
        office_id: row.office_id,
        office_name: row.office?.name ?? "—",
        office_code: row.office?.code ?? "",
        units_issued: 0,
        transactions: 0,
        remaining: 0,
      }
      entry.units_issued += Math.abs(Number(row.quantity))
      entry.transactions += 1
      totals.set(row.office_id, entry)
    }

    // Attach the current remaining balance per office so the report shows both
    // what went out and what is left.
    const { data: stocks } = await ctx.supabase
      .schema(SCHEMA)
      .from("office_stocks")
      .select("office_id, quantity, office:offices!office_id(id, name, code)")

    for (const s of (stocks ?? []) as unknown as {
      office_id: string
      quantity: number
      office: { name: string; code: string } | null
    }[]) {
      if (filters.officeId && s.office_id !== filters.officeId) continue
      const entry = totals.get(s.office_id) ?? {
        office_id: s.office_id,
        office_name: s.office?.name ?? "—",
        office_code: s.office?.code ?? "",
        units_issued: 0,
        transactions: 0,
        remaining: 0,
      }
      entry.remaining += Number(s.quantity)
      totals.set(s.office_id, entry)
    }

    return {
      error: null,
      data: [...totals.values()].sort((a, b) => b.units_issued - a.units_issued),
    }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function getIssuanceByCategory(
  filters: ReportFilters
): Promise<ActionResult<CategoryIssuance[]>> {
  try {
    const { rows } = await fetchReleases(filters)

    const totals = new Map<string, { units: number; items: Set<string> }>()
    for (const row of rows) {
      const key = row.item?.category?.name ?? "UNCATEGORIZED"
      const entry = totals.get(key) ?? { units: 0, items: new Set<string>() }
      entry.units += Math.abs(Number(row.quantity))
      entry.items.add(row.item_id)
      totals.set(key, entry)
    }

    return {
      error: null,
      data: [...totals.entries()]
        .map(([category, v]) => ({
          category,
          units_issued: v.units,
          items: v.items.size,
        }))
        .sort((a, b) => b.units_issued - a.units_issued),
    }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function getMonthlyTrends(
  year: number
): Promise<ActionResult<MonthlyTrend[]>> {
  try {
    const from = new Date(year, 0, 1).toISOString()
    const to = new Date(year, 11, 31, 23, 59, 59).toISOString()
    const { ctx, rows } = await fetchReleases({ from, to: to.slice(0, 10) })

    const byMonth = new Map<number, { units: number; requests: Set<string> }>()
    for (const row of rows) {
      const month = new Date(row.created_at).getMonth() + 1
      const entry = byMonth.get(month) ?? { units: 0, requests: new Set<string>() }
      entry.units += Math.abs(Number(row.quantity))
      if (row.request_id) entry.requests.add(row.request_id)
      byMonth.set(month, entry)
    }

    // Keep a reference to ctx so the permission check is not optimized away.
    void ctx

    return {
      error: null,
      data: Array.from({ length: 12 }, (_, i) => {
        const entry = byMonth.get(i + 1)
        return {
          month: i + 1,
          units_issued: entry?.units ?? 0,
          requests: entry?.requests.size ?? 0,
        }
      }),
    }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function getRequestStatusCounts(
  filters: ReportFilters
): Promise<ActionResult<Record<RequestStatus, number>>> {
  const empty: Record<RequestStatus, number> = {
    pending: 0,
    approved: 0,
    partially_released: 0,
    released: 0,
    rejected: 0,
    cancelled: 0,
  }

  try {
    const ctx = await requirePermission("reports.view")

    let query = ctx.supabase.schema(SCHEMA).from("requests").select("status")
    if (filters.from) query = query.gte("requested_at", filters.from)
    if (filters.to) query = query.lte("requested_at", `${filters.to}T23:59:59.999Z`)
    if (filters.officeId) query = query.eq("office_id", filters.officeId)

    const { data, error } = await query
    if (error) return { error: error.message, data: empty }

    const counts = { ...empty }
    for (const row of (data ?? []) as { status: RequestStatus }[]) {
      counts[row.status] = (counts[row.status] ?? 0) + 1
    }
    return { error: null, data: counts }
  } catch (e) {
    return { error: toError(e), data: empty }
  }
}

/* ── Exports ───────────────────────────────────────────────────────────── */

export interface StockExportRow {
  office_code: string
  office_name: string
  category: string
  item: string
  unit: string
  opening: number
  issued: number
  remaining: number
}

/** Full per-office stock position — mirrors the source spreadsheet layout. */
export async function getStockForExport(
  officeId?: string
): Promise<ActionResult<StockExportRow[]>> {
  try {
    const ctx = await requirePermission("reports.view")

    // Supabase caps a single response; page through so large exports are complete.
    // Each page rebuilds the query — a PostgREST builder is single-use.
    const pageSize = 1000
    const rows: StockExportRow[] = []
    for (let page = 0; ; page++) {
      let query = ctx.supabase
        .schema(SCHEMA)
        .from("office_stocks")
        .select(
          "quantity, opening_quantity, office:offices!office_id(name, code), item:items!item_id(name, category:categories(name), unit:units(code))"
        )
        .order("office_id")

      if (officeId) query = query.eq("office_id", officeId)

      const { data, error } = await query.range(
        page * pageSize,
        page * pageSize + pageSize - 1
      )
      if (error) return { error: error.message, data: [] }

      const batch = (data ?? []) as unknown as {
        quantity: number
        opening_quantity: number
        office: { name: string; code: string } | null
        item: {
          name: string
          category: { name: string } | null
          unit: { code: string } | null
        } | null
      }[]

      for (const r of batch) {
        rows.push({
          office_code: r.office?.code ?? "",
          office_name: r.office?.name ?? "",
          category: r.item?.category?.name ?? "",
          item: r.item?.name ?? "",
          unit: r.item?.unit?.code ?? "",
          opening: Number(r.opening_quantity),
          issued: Number(r.opening_quantity) - Number(r.quantity),
          remaining: Number(r.quantity),
        })
      }

      if (batch.length < pageSize) break
    }

    return { error: null, data: rows }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export interface MovementExportRow {
  date: string
  request_no: string
  office_code: string
  office_name: string
  category: string
  item: string
  unit: string
  type: string
  quantity: number
  balance_after: number
  performed_by: string
  remarks: string
}

export async function getMovementsForExport(
  filters: ReportFilters
): Promise<ActionResult<MovementExportRow[]>> {
  try {
    const ctx = await requirePermission("reports.view")

    let query = ctx.supabase
      .schema(SCHEMA)
      .from("stock_movements")
      .select(
        "created_at, movement_type, quantity, balance_after, remarks, office:offices!office_id(name, code), item:items!item_id(name, category:categories(name), unit:units(code)), performer:user_profiles!performed_by(full_name), request:requests!request_id(request_no)"
      )
      .order("created_at", { ascending: false })

    if (filters.from) query = query.gte("created_at", filters.from)
    if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`)
    if (filters.officeId) query = query.eq("office_id", filters.officeId)

    const { data, error } = await query.limit(5000)
    if (error) return { error: error.message, data: [] }

    return {
      error: null,
      data: (data ?? []).map((r: unknown) => {
        const row = r as {
          created_at: string
          movement_type: string
          quantity: number
          balance_after: number
          remarks: string | null
          office: { name: string; code: string } | null
          item: {
            name: string
            category: { name: string } | null
            unit: { code: string } | null
          } | null
          performer: { full_name: string } | null
          request: { request_no: string } | null
        }
        return {
          date: row.created_at,
          request_no: row.request?.request_no ?? "",
          office_code: row.office?.code ?? "",
          office_name: row.office?.name ?? "",
          category: row.item?.category?.name ?? "",
          item: row.item?.name ?? "",
          unit: row.item?.unit?.code ?? "",
          type: row.movement_type,
          quantity: Number(row.quantity),
          balance_after: Number(row.balance_after),
          performed_by: row.performer?.full_name ?? "",
          remarks: row.remarks ?? "",
        }
      }),
    }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}
