"use server"

import { revalidatePath } from "next/cache"
import { requireSession, requirePermission, toError, SCHEMA } from "@/lib/auth/session"
import type { ActionResult } from "@/types/database"

export interface SystemSettings {
  fiscal_year: number
  low_stock_threshold: number
  allow_over_release: boolean
}

const DEFAULTS: SystemSettings = {
  fiscal_year: new Date().getFullYear(),
  low_stock_threshold: 5,
  allow_over_release: false,
}

export async function getSystemSettings(): Promise<
  ActionResult<SystemSettings>
> {
  try {
    const ctx = await requireSession()

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("system_settings")
      .select("key, value")

    if (error) return { error: error.message, data: DEFAULTS }

    const settings = { ...DEFAULTS }
    for (const row of (data ?? []) as { key: string; value: unknown }[]) {
      if (row.key === "fiscal_year") {
        settings.fiscal_year = Number(row.value) || DEFAULTS.fiscal_year
      }
      if (row.key === "low_stock_threshold") {
        settings.low_stock_threshold =
          Number(row.value) || DEFAULTS.low_stock_threshold
      }
      if (row.key === "allow_over_release") {
        settings.allow_over_release = row.value === true || row.value === "true"
      }
    }

    return { error: null, data: settings }
  } catch (e) {
    return { error: toError(e), data: DEFAULTS }
  }
}

export async function updateSystemSettings(
  input: Partial<SystemSettings>
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("admin.manage")

    const updates: { key: string; value: unknown }[] = []
    if (input.fiscal_year !== undefined) {
      updates.push({ key: "fiscal_year", value: Number(input.fiscal_year) })
    }
    if (input.low_stock_threshold !== undefined) {
      const value = Number(input.low_stock_threshold)
      if (value < 0) return { error: "Threshold cannot be negative.", data: null }
      updates.push({ key: "low_stock_threshold", value })
    }
    if (input.allow_over_release !== undefined) {
      updates.push({ key: "allow_over_release", value: input.allow_over_release })
    }

    for (const update of updates) {
      const { error } = await ctx.supabase
        .schema(SCHEMA)
        .from("system_settings")
        .upsert(
          {
            key: update.key,
            value: update.value,
            updated_by: ctx.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        )

      if (error) return { error: error.message, data: null }
    }

    revalidatePath("/dashboard/admin/settings")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}
