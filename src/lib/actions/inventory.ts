"use server"

import { revalidatePath } from "next/cache"
import {
  requireSession,
  requirePermission,
  toError,
  SCHEMA,
} from "@/lib/auth/session"
import { adjustStockSchema } from "@/lib/schemas/gso"
import { getSystemSettings } from "@/lib/actions/settings"
import type {
  ActionResult,
  OfficeStockRow,
  StockMovementRow,
} from "@/types/database"

const STOCK_SELECT = `
  *,
  office:offices!office_id(id, name, code),
  item:items!item_id(*, category:categories(id, name), unit:units(id, code, name))
`

const MOVEMENT_SELECT = `
  *,
  office:offices!office_id(id, name, code),
  item:items!item_id(*, category:categories(id, name), unit:units(id, code, name)),
  performer:user_profiles!performed_by(id, full_name),
  request:requests!request_id(id, request_no)
`

/**
 * Every stock row the caller may see, unpaginated — the inventory table filters
 * and pages in the browser. Bounded by one office × item row per fiscal year
 * (1,476 for 2026), so this is a fixed, known size.
 */
export async function getAllOfficeStocks(): Promise<
  ActionResult<OfficeStockRow[]>
> {
  try {
    const ctx = await requirePermission("inventory.view")

    let query = ctx.supabase
      .schema(SCHEMA)
      .from("office_stocks")
      .select(STOCK_SELECT)
      .order("quantity", { ascending: true })

    if (!ctx.canViewAll) {
      if (!ctx.profile.office_id) return { error: null, data: [] }
      query = query.eq("office_id", ctx.profile.office_id)
    }

    // Issuance comes from the ledger, never from `opening_quantity - quantity`:
    // an opening balance moves both columns and a replenishment moves only one,
    // so that subtraction answers "how much has gone out" for exactly one kind
    // of row — the ones the 2026 seed created and nobody has restocked.
    const settings = await getSystemSettings()
    const [{ data, error }, issuedResult] = await Promise.all([
      query,
      ctx.supabase.schema(SCHEMA).rpc("office_stock_issued", {
        p_fiscal_year: settings.data.fiscal_year,
        p_office_id: ctx.canViewAll ? null : ctx.profile.office_id,
      }),
    ])

    if (error) return { error: error.message, data: [] }
    if (issuedResult.error) {
      return { error: issuedResult.error.message, data: [] }
    }

    const issued = new Map<string, number>()
    for (const row of (issuedResult.data ?? []) as {
      office_id: string
      item_id: string
      issued: number
    }[]) {
      issued.set(`${row.office_id}:${row.item_id}`, Number(row.issued))
    }

    const rows = (data ?? []) as unknown as OfficeStockRow[]
    for (const row of rows) {
      row.issued = issued.get(`${row.office_id}:${row.item_id}`) ?? 0
    }

    return { error: null, data: rows }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

/**
 * The ledger grows with every release, so unlike the other tables it cannot be
 * loaded whole. Returns the most recent `MOVEMENT_FETCH_LIMIT` rows plus the
 * true total, and the page tells the user when it is showing a slice.
 */
// Not exported: a "use server" file may only export async functions. The
// effective limit travels back to the caller in the result payload instead.
const MOVEMENT_FETCH_LIMIT = 5000

export async function getAllStockMovements(): Promise<
  ActionResult<{ rows: StockMovementRow[]; total: number; limit: number }>
> {
  const empty = { rows: [], total: 0, limit: MOVEMENT_FETCH_LIMIT }
  try {
    const ctx = await requirePermission("inventory.view")

    let query = ctx.supabase
      .schema(SCHEMA)
      .from("stock_movements")
      .select(MOVEMENT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })

    if (!ctx.canViewAll) {
      if (!ctx.profile.office_id) return { error: null, data: empty }
      query = query.eq("office_id", ctx.profile.office_id)
    }

    const { data, count, error } = await query.range(
      0,
      MOVEMENT_FETCH_LIMIT - 1
    )
    if (error) return { error: error.message, data: empty }

    return {
      error: null,
      data: {
        rows: (data ?? []) as unknown as StockMovementRow[],
        total: count ?? 0,
        limit: MOVEMENT_FETCH_LIMIT,
      },
    }
  } catch (e) {
    return { error: toError(e), data: empty }
  }
}

/**
 * Replenishment, return, or manual correction. Routed through the
 * `adjust_stock` RPC so the balance and its ledger row are written together.
 */
export async function adjustStock(
  input: unknown
): Promise<ActionResult<{ balance: number } | null>> {
  try {
    const ctx = await requirePermission("inventory.adjust")
    const parsed = adjustStockSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0].message, data: null }
    }
    const values = parsed.data

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .rpc("adjust_stock", {
        p_office_id: values.office_id,
        p_item_id: values.item_id,
        p_quantity: values.quantity,
        p_movement_type: values.movement_type,
        p_actor_id: ctx.userId,
        p_remarks: values.remarks ?? null,
      })

    if (error) return { error: error.message, data: null }

    revalidatePath("/dashboard/inventory")
    revalidatePath("/dashboard/movements")
    revalidatePath("/dashboard")
    return { error: null, data: { balance: Number(data) } }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/** Balance history for a single item at a single office. */
export async function getItemHistory(
  officeId: string,
  itemId: string
): Promise<ActionResult<StockMovementRow[]>> {
  try {
    const ctx = await requireSession()

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("stock_movements")
      .select(MOVEMENT_SELECT)
      .eq("office_id", officeId)
      .eq("item_id", itemId)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as unknown as StockMovementRow[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}
