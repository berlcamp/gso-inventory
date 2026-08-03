"use server"

import { requirePermission, toError, SCHEMA } from "@/lib/auth/session"
import { getSystemSettings } from "@/lib/actions/settings"
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
    awaiting_endorsement: 0,
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

/* ── Forecasting input ─────────────────────────────────────────────────── */

export interface ConsumptionForecastRow {
  item: string
  category: string
  unit: string
  year: number
  month: number
  is_partial_month: number
  units_issued: number
  units_returned: number
  requests: number
  opening_qty: number
  remaining_qty: number
  reorder_level: number
  data_start: string
  data_end: string
  months_covered: number
}

const PAGE_SIZE = 1000

/**
 * Reads a table to exhaustion. Supabase caps a single response, and a
 * PostgREST builder is single-use, so the caller supplies a factory that
 * rebuilds the query per page rather than a builder to re-range.
 */
async function fetchAllPages<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await page(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) return { rows: [], error: error.message }
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return { rows, error: null }
}

/** Months are compared as a single ordinal so spanning a year boundary is arithmetic. */
const toOrdinal = (year: number, month: number) => year * 12 + (month - 1)
const fromOrdinal = (n: number) => ({ year: Math.floor(n / 12), month: (n % 12) + 1 })
const monthLabel = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`

/**
 * Monthly consumption per item, summed across every office — the input for a
 * forecasting pass run outside the app.
 *
 * Deliberately takes no filters. Handing a forecaster a truncated window is
 * the main way this export produces a wrong answer, so it always covers every
 * office and the whole ledger regardless of what the Reports page has set.
 *
 * Quiet months are emitted as explicit zeros: a month that is missing and a
 * month that saw no issuance mean very different things to a forecast, and
 * only one of them is visible if the row is simply absent.
 */
export async function getConsumptionForForecast(): Promise<
  ActionResult<ConsumptionForecastRow[]>
> {
  try {
    const ctx = await requirePermission("reports.view")
    const { data: settings } = await getSystemSettings()

    // Item metadata, resolved once so neither pass below has to re-join it.
    const catalog = await fetchAllPages<{
      id: string
      name: string
      reorder_level: number
      category: { name: string } | null
      unit: { code: string } | null
    }>((from, to) =>
      ctx.supabase
        .schema(SCHEMA)
        .from("items")
        .select("id, name, reorder_level, category:categories(name), unit:units(code)")
        .order("id")
        .range(from, to)
    )
    if (catalog.error) return { error: catalog.error, data: [] }

    const meta = new Map(
      catalog.rows.map((r) => [
        r.id,
        {
          item: r.name,
          category: r.category?.name ?? "UNCATEGORIZED",
          unit: r.unit?.code ?? "",
          reorder_level: Number(r.reorder_level),
        },
      ])
    )

    // Citywide allocation position per item, for the settings fiscal year.
    const stocks = await fetchAllPages<{
      item_id: string
      quantity: number
      opening_quantity: number
    }>((from, to) =>
      ctx.supabase
        .schema(SCHEMA)
        .from("office_stocks")
        .select("item_id, quantity, opening_quantity")
        .eq("fiscal_year", settings.fiscal_year)
        // Ordered by the primary key, not item_id: paging needs a unique sort
        // key or rows sharing one can be skipped or repeated across a page
        // boundary, quietly corrupting the sums below.
        .order("id")
        .range(from, to)
    )
    if (stocks.error) return { error: stocks.error, data: [] }

    const position = new Map<string, { opening: number; remaining: number }>()
    for (const row of stocks.rows) {
      const entry = position.get(row.item_id) ?? { opening: 0, remaining: 0 }
      entry.opening += Number(row.opening_quantity)
      entry.remaining += Number(row.quantity)
      position.set(row.item_id, entry)
    }

    // The ledger, in full. Releases and returns stay separate — how to treat a
    // return is a judgement for whoever reads the file, not one to bake in here.
    const movements = await fetchAllPages<{
      item_id: string
      quantity: number
      movement_type: string
      request_id: string | null
      created_at: string
    }>((from, to) =>
      ctx.supabase
        .schema(SCHEMA)
        .from("stock_movements")
        .select("item_id, quantity, movement_type, request_id, created_at")
        .in("movement_type", ["release", "return"])
        // Primary key again — created_at is not unique enough to page on.
        .order("id")
        .range(from, to)
    )
    if (movements.error) return { error: movements.error, data: [] }

    type Bucket = { issued: number; returned: number; requests: Set<string> }
    const buckets = new Map<string, Bucket>()
    const key = (itemId: string, ordinal: number) => `${itemId}@${ordinal}`

    let earliest: number | null = null
    for (const row of movements.rows) {
      const at = new Date(row.created_at)
      const ordinal = toOrdinal(at.getFullYear(), at.getMonth() + 1)
      if (earliest === null || ordinal < earliest) earliest = ordinal

      const bucket = buckets.get(key(row.item_id, ordinal)) ?? {
        issued: 0,
        returned: 0,
        requests: new Set<string>(),
      }
      if (row.movement_type === "release") {
        bucket.issued += Math.abs(Number(row.quantity))
        if (row.request_id) bucket.requests.add(row.request_id)
      } else {
        bucket.returned += Math.abs(Number(row.quantity))
      }
      buckets.set(key(row.item_id, ordinal), bucket)
    }

    // Row space is every item an office holds an allocation for, unioned with
    // every item that has actually moved. The union matters in both
    // directions: an allocated item nobody touched is a signal to procure
    // less, and consumption must never vanish because its allocation row did.
    const itemIds = new Set<string>([
      ...position.keys(),
      ...movements.rows.map((r) => r.item_id),
    ])

    const now = new Date()
    const latest = toOrdinal(now.getFullYear(), now.getMonth() + 1)
    const start = earliest ?? latest
    const span = Array.from({ length: latest - start + 1 }, (_, i) => start + i)

    const startAt = fromOrdinal(start)
    const endAt = fromOrdinal(latest)
    const coverage = {
      data_start: monthLabel(startAt.year, startAt.month),
      data_end: monthLabel(endAt.year, endAt.month),
      months_covered: span.length,
    }

    const rows: ConsumptionForecastRow[] = []
    for (const itemId of itemIds) {
      const info = meta.get(itemId)
      if (!info) continue // item deleted from the catalog; nothing to label it with

      const stock = position.get(itemId) ?? { opening: 0, remaining: 0 }

      for (const ordinal of span) {
        const { year, month } = fromOrdinal(ordinal)
        const bucket = buckets.get(key(itemId, ordinal))
        rows.push({
          ...info,
          year,
          month,
          // The last month is still in progress, so its total is not
          // comparable to the others. Averaging it in unflagged reads as a
          // downturn that has not happened.
          is_partial_month: ordinal === latest ? 1 : 0,
          units_issued: bucket?.issued ?? 0,
          units_returned: bucket?.returned ?? 0,
          requests: bucket?.requests.size ?? 0,
          opening_qty: stock.opening,
          remaining_qty: stock.remaining,
          ...coverage,
        })
      }
    }

    rows.sort(
      (a, b) =>
        a.item.localeCompare(b.item) ||
        a.year - b.year ||
        a.month - b.month
    )

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
