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

export async function getOfficeStocks(params: {
  officeId?: string
  categoryId?: string
  search?: string
  lowOnly?: boolean
  page?: number
  pageSize?: number
}): Promise<ActionResult<{ rows: OfficeStockRow[]; count: number }>> {
  try {
    const ctx = await requirePermission("inventory.view")
    const page = Math.max(1, params.page ?? 1)
    const pageSize = params.pageSize ?? 25

    let query = ctx.supabase
      .schema(SCHEMA)
      .from("office_stocks")
      .select(STOCK_SELECT, { count: "exact" })

    // Without cross-office visibility a user only sees their own office.
    if (!ctx.canViewAll) {
      if (!ctx.profile.office_id) {
        return { error: null, data: { rows: [], count: 0 } }
      }
      query = query.eq("office_id", ctx.profile.office_id)
    } else if (params.officeId) {
      query = query.eq("office_id", params.officeId)
    }

    if (params.categoryId) {
      query = query.eq("item.category_id", params.categoryId)
    }
    if (params.search?.trim()) {
      query = query.ilike("item.name", `%${params.search.trim()}%`)
    }
    // PostgREST returns null embeds for non-matching filtered relations —
    // this keeps only the rows whose item actually matched.
    if (params.categoryId || params.search?.trim()) {
      query = query.not("item", "is", null)
    }
    if (params.lowOnly) {
      const { data: settings } = await getSystemSettings()
      query = query.lte("quantity", settings.low_stock_threshold)
    }

    const from = (page - 1) * pageSize
    query = query
      .order("quantity", { ascending: true })
      .range(from, from + pageSize - 1)

    const { data, count, error } = await query
    if (error) return { error: error.message, data: { rows: [], count: 0 } }

    return {
      error: null,
      data: {
        rows: (data ?? []) as unknown as OfficeStockRow[],
        count: count ?? 0,
      },
    }
  } catch (e) {
    return { error: toError(e), data: { rows: [], count: 0 } }
  }
}

export async function getStockMovements(params: {
  officeId?: string
  itemId?: string
  movementType?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}): Promise<ActionResult<{ rows: StockMovementRow[]; count: number }>> {
  try {
    const ctx = await requirePermission("inventory.view")
    const page = Math.max(1, params.page ?? 1)
    const pageSize = params.pageSize ?? 25

    let query = ctx.supabase
      .schema(SCHEMA)
      .from("stock_movements")
      .select(MOVEMENT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })

    if (!ctx.canViewAll) {
      if (!ctx.profile.office_id) {
        return { error: null, data: { rows: [], count: 0 } }
      }
      query = query.eq("office_id", ctx.profile.office_id)
    } else if (params.officeId) {
      query = query.eq("office_id", params.officeId)
    }

    if (params.itemId) query = query.eq("item_id", params.itemId)
    if (params.movementType && params.movementType !== "all") {
      query = query.eq("movement_type", params.movementType)
    }
    if (params.from) query = query.gte("created_at", params.from)
    if (params.to) query = query.lte("created_at", `${params.to}T23:59:59.999Z`)

    const from = (page - 1) * pageSize
    query = query.range(from, from + pageSize - 1)

    const { data, count, error } = await query
    if (error) return { error: error.message, data: { rows: [], count: 0 } }

    return {
      error: null,
      data: {
        rows: (data ?? []) as unknown as StockMovementRow[],
        count: count ?? 0,
      },
    }
  } catch (e) {
    return { error: toError(e), data: { rows: [], count: 0 } }
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
