/**
 * Server-side session helpers shared by every server action.
 *
 * Kept out of the `"use server"` action files on purpose — those may only
 * export async functions, so non-action exports (types, constants) live here.
 */

import { createClient } from "@/lib/supabase/server"

export const SCHEMA = "gso_inventory" as const

export interface SessionContext {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  profile: {
    id: string
    full_name: string
    email: string
    office_id: string | null
    is_active: boolean
  }
  permissions: string[]
  /** Convenience: this user may see requests from every office. */
  canViewAll: boolean
}

/**
 * Resolves the signed-in user's profile and effective permission codes.
 * Throws on anything that should abort the action — callers wrap in try/catch
 * and return `{ error }` rather than letting it reach the client.
 */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error("Not signed in.")

  const { data: profile } = await supabase
    .schema(SCHEMA)
    .from("user_profiles")
    .select("id, full_name, email, office_id, is_active")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile) throw new Error("No profile is registered for this account.")
  if (profile.is_active === false) throw new Error("This account is deactivated.")

  const { data: userRoles } = await supabase
    .schema(SCHEMA)
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id)

  const roleIds = (userRoles ?? []).map((r: { role_id: string }) => r.role_id)

  let permissions: string[] = []
  if (roleIds.length > 0) {
    const { data: rolePerms } = await supabase
      .schema(SCHEMA)
      .from("role_permissions")
      .select("permission:permissions(code)")
      .in("role_id", roleIds)

    permissions = [
      ...new Set(
        (rolePerms ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((rp: any) => (rp.permission as { code: string } | null)?.code)
          .filter(Boolean) as string[]
      ),
    ]
  }

  return {
    supabase,
    userId: user.id,
    profile,
    permissions,
    canViewAll: permissions.includes("request.view_all"),
  }
}

/** Same as `requireSession`, but aborts unless the user holds one of `codes`. */
export async function requirePermission(
  ...codes: string[]
): Promise<SessionContext> {
  const ctx = await requireSession()
  if (!codes.some((c) => ctx.permissions.includes(c))) {
    throw new Error(
      `You do not have permission to do this (requires: ${codes.join(" or ")}).`
    )
  }
  return ctx
}

/** Normalizes a thrown error into the action result envelope. */
export function toError(e: unknown): string {
  if (e instanceof Error) return e.message
  return "Something went wrong."
}
