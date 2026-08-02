/**
 * Office balance arithmetic, shared by the write paths (`createRequest`,
 * `approveRequest`) and the item picker that feeds them.
 *
 * This module is deliberately **not** `"use server"` — it exports plain
 * functions and types that server actions call, not actions themselves.
 */

import { SCHEMA, type SessionContext } from "@/lib/auth/session"

/**
 * What an office can still genuinely claim of an item.
 *
 * `balance` is the office's remaining allocation, which only moves on release.
 * `committed` is what other already-approved requests have spoken for but not
 * yet collected — without subtracting it, two requests could each be approved
 * for the whole balance and the second would only fail at the counter.
 */
export interface Availability {
  itemName: string
  /** `null` when the office has no allocation row for the item at all. */
  balance: number | null
  committed: number
}

export async function loadAvailability(
  ctx: SessionContext,
  officeId: string,
  itemIds: string[],
  fiscalYear: number,
  /** The request being approved — its own lines aren't a competing claim. */
  excludeRequestId?: string
): Promise<Map<string, Availability>> {
  const result = new Map<string, Availability>()
  if (itemIds.length === 0) return result

  let openLines = ctx.supabase
    .schema(SCHEMA)
    .from("request_items")
    .select(
      "item_id, quantity_requested, quantity_approved, quantity_released, request:requests!inner(office_id, status, fiscal_year)"
    )
    .in("item_id", itemIds)
    .eq("request.office_id", officeId)
    .eq("request.fiscal_year", fiscalYear)
    .in("request.status", ["approved", "partially_released"])

  if (excludeRequestId) openLines = openLines.neq("request_id", excludeRequestId)

  const [{ data: items }, { data: stocks }, { data: outstanding }] =
    await Promise.all([
      ctx.supabase
        .schema(SCHEMA)
        .from("items")
        .select("id, name")
        .in("id", itemIds),
      ctx.supabase
        .schema(SCHEMA)
        .from("office_stocks")
        .select("item_id, quantity")
        .eq("office_id", officeId)
        .eq("fiscal_year", fiscalYear)
        .in("item_id", itemIds),
      openLines,
    ])

  for (const id of itemIds) {
    result.set(id, { itemName: "this item", balance: null, committed: 0 })
  }

  for (const item of (items ?? []) as { id: string; name: string }[]) {
    const entry = result.get(item.id)
    if (entry) entry.itemName = item.name
  }

  for (const stock of (stocks ?? []) as {
    item_id: string
    quantity: number
  }[]) {
    const entry = result.get(stock.item_id)
    if (entry) entry.balance = Number(stock.quantity)
  }

  for (const line of (outstanding ?? []) as {
    item_id: string
    quantity_requested: number
    quantity_approved: number | null
    quantity_released: number
  }[]) {
    const entry = result.get(line.item_id)
    if (!entry) continue
    const approved = Number(line.quantity_approved ?? line.quantity_requested)
    entry.committed += Math.max(0, approved - Number(line.quantity_released))
  }

  return result
}

/**
 * Turns the availability map into human-readable problems. Returns every
 * failing line, not just the first, so a long request can be fixed in one pass.
 *
 * `allowOverRelease` mirrors what `release_request` does with the same setting:
 * the quantity ceiling is waived, but an item the office holds no allocation
 * for is still refused — there is no balance to go negative from.
 */
export function checkAgainstAvailability(
  lines: { item_id: string; quantity: number }[],
  availability: Map<string, Availability>,
  fiscalYear: number,
  allowOverRelease: boolean
): string | null {
  const problems: string[] = []

  for (const line of lines) {
    const entry = availability.get(line.item_id)
    if (!entry) continue

    if (entry.balance === null) {
      problems.push(
        `${entry.itemName}: the requesting office has no ${fiscalYear} allocation for this item.`
      )
      continue
    }

    if (allowOverRelease) continue

    const free = entry.balance - entry.committed
    if (line.quantity > free) {
      problems.push(
        entry.committed > 0
          ? `${entry.itemName}: ${line.quantity.toLocaleString()} requested but only ${free.toLocaleString()} available — ${entry.balance.toLocaleString()} remaining, ${entry.committed.toLocaleString()} already approved for release.`
          : `${entry.itemName}: ${line.quantity.toLocaleString()} requested but only ${entry.balance.toLocaleString()} remaining.`
      )
    }
  }

  if (problems.length === 0) return null
  if (problems.length <= 3) return problems.join(" ")
  return `${problems.slice(0, 3).join(" ")} …and ${problems.length - 3} more.`
}
