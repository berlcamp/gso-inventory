"use server"

import { revalidatePath } from "next/cache"
import { requireSession, requirePermission, toError, SCHEMA } from "@/lib/auth/session"
import { itemSchema, officeSchema } from "@/lib/schemas/gso"
import type {
  ActionResult,
  Category,
  ItemWithRefs,
  Office,
  Unit,
} from "@/types/database"

const ITEM_SELECT = `*, category:categories(id, name), unit:units(id, code, name)`

/* ── Lookups (used to populate every dropdown in the app) ──────────────── */

export async function getOffices(
  includeInactive = false
): Promise<ActionResult<Office[]>> {
  try {
    const ctx = await requireSession()
    let query = ctx.supabase.schema(SCHEMA).from("offices").select("*").order("name")
    if (!includeInactive) query = query.eq("is_active", true)

    const { data, error } = await query
    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as Office[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function getCategories(): Promise<ActionResult<Category[]>> {
  try {
    const ctx = await requireSession()
    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("categories")
      .select("*")
      .order("name")

    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as Category[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function getUnits(): Promise<ActionResult<Unit[]>> {
  try {
    const ctx = await requireSession()
    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("units")
      .select("*")
      .order("code")

    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as Unit[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

/** The whole catalog, unpaginated — the items table filters in the browser. */
export async function getAllItems(): Promise<ActionResult<ItemWithRefs[]>> {
  try {
    const ctx = await requireSession()

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("items")
      .select(ITEM_SELECT)
      .order("name")

    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as unknown as ItemWithRefs[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

/**
 * Type-ahead for the request builder. Returns the item plus the requesting
 * office's remaining balance so the form can warn before an over-request.
 */
export async function searchItemsForOffice(
  officeId: string,
  query: string
): Promise<ActionResult<(ItemWithRefs & { available: number })[]>> {
  try {
    const ctx = await requireSession()
    const term = query.trim()

    let itemQuery = ctx.supabase
      .schema(SCHEMA)
      .from("items")
      .select(ITEM_SELECT)
      .eq("is_active", true)
      .order("name")
      .limit(25)

    if (term) itemQuery = itemQuery.ilike("name", `%${term}%`)

    const { data: items, error } = await itemQuery
    if (error) return { error: error.message, data: [] }

    const ids = (items ?? []).map((i: { id: string }) => i.id)
    if (ids.length === 0) return { error: null, data: [] }

    const { data: stocks } = await ctx.supabase
      .schema(SCHEMA)
      .from("office_stocks")
      .select("item_id, quantity")
      .eq("office_id", officeId)
      .in("item_id", ids)

    const balances: Record<string, number> = {}
    for (const s of (stocks ?? []) as { item_id: string; quantity: number }[]) {
      balances[s.item_id] = Number(s.quantity)
    }

    return {
      error: null,
      data: (items ?? []).map((i: unknown) => {
        const item = i as ItemWithRefs
        return { ...item, available: balances[item.id] ?? 0 }
      }),
    }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

/* ── Item maintenance ──────────────────────────────────────────────────── */

export async function createItem(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("item.manage")
    const parsed = itemSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0].message, data: null }

    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("items")
      .insert(parsed.data)

    if (error) {
      return {
        error: error.code === "23505"
          ? "An item with this name and unit already exists."
          : error.message,
        data: null,
      }
    }

    revalidatePath("/dashboard/items")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

export async function updateItem(
  id: string,
  input: unknown
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("item.manage")
    const parsed = itemSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0].message, data: null }

    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("items")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", id)

    if (error) {
      return {
        error: error.code === "23505"
          ? "An item with this name and unit already exists."
          : error.message,
        data: null,
      }
    }

    revalidatePath("/dashboard/items")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

export async function createCategory(name: string): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("item.manage")
    const trimmed = name.trim()
    if (trimmed.length < 2) return { error: "Category name is too short.", data: null }

    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("categories")
      .insert({ name: trimmed.toUpperCase() })

    if (error) {
      return {
        error: error.code === "23505" ? "That category already exists." : error.message,
        data: null,
      }
    }

    revalidatePath("/dashboard/items")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

export async function createUnit(
  code: string,
  name: string
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("item.manage")
    const trimmedCode = code.trim().toUpperCase()
    if (!trimmedCode) return { error: "Unit code is required.", data: null }

    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("units")
      .insert({ code: trimmedCode, name: name.trim() || trimmedCode })

    if (error) {
      return {
        error: error.code === "23505" ? "That unit already exists." : error.message,
        data: null,
      }
    }

    revalidatePath("/dashboard/items")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/* ── Office maintenance ────────────────────────────────────────────────── */

export async function getOfficesWithOfficers(): Promise<
  ActionResult<(Office & { officers: { id: string; full_name: string; email: string; position: string | null }[] })[]>
> {
  try {
    const ctx = await requireSession()

    const [officesResult, profilesResult] = await Promise.all([
      ctx.supabase.schema(SCHEMA).from("offices").select("*").order("name"),
      ctx.supabase
        .schema(SCHEMA)
        .from("user_profiles")
        .select("id, full_name, email, position, office_id, is_active")
        .eq("is_active", true),
    ])

    if (officesResult.error) {
      return { error: officesResult.error.message, data: [] }
    }

    const byOffice = new Map<
      string,
      { id: string; full_name: string; email: string; position: string | null }[]
    >()
    for (const p of (profilesResult.data ?? []) as {
      id: string
      full_name: string
      email: string
      position: string | null
      office_id: string | null
    }[]) {
      if (!p.office_id) continue
      const list = byOffice.get(p.office_id) ?? []
      list.push({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        position: p.position,
      })
      byOffice.set(p.office_id, list)
    }

    return {
      error: null,
      data: ((officesResult.data ?? []) as Office[]).map((o) => ({
        ...o,
        officers: byOffice.get(o.id) ?? [],
      })),
    }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function createOffice(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("office.manage")
    const parsed = officeSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0].message, data: null }

    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("offices")
      .insert({ ...parsed.data, code: parsed.data.code.toUpperCase() })

    if (error) {
      return {
        error: error.code === "23505"
          ? "An office with that name or code already exists."
          : error.message,
        data: null,
      }
    }

    revalidatePath("/dashboard/offices")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

export async function updateOffice(
  id: string,
  input: unknown
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("office.manage")
    const parsed = officeSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0].message, data: null }

    const { error } = await ctx.supabase
      .schema(SCHEMA)
      .from("offices")
      .update({
        ...parsed.data,
        code: parsed.data.code.toUpperCase(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)

    if (error) {
      return {
        error: error.code === "23505"
          ? "An office with that name or code already exists."
          : error.message,
        data: null,
      }
    }

    revalidatePath("/dashboard/offices")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}
