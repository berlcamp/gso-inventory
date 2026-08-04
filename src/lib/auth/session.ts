/**
 * Server-side session helpers shared by every server action.
 *
 * Kept out of the `"use server"` action files on purpose — those may only
 * export async functions, so non-action exports (types, constants) live here.
 */

import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

export const SCHEMA = "gso_inventory" as const

export interface SessionOffice {
  id: string
  name: string
  code: string
  is_gso: boolean
}

export interface SessionProfile {
  id: string
  full_name: string
  email: string
  /**
   * The **primary** office — what the topbar shows and what a new request
   * defaults to. Authorization reads `officeIds`, never this: someone can act
   * for several offices, and this one is only the first among them.
   */
  office_id: string | null
  position: string | null
  avatar_url: string | null
  is_active: boolean
  office: SessionOffice | null
}

export interface SessionContext {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  profile: SessionProfile
  roles: string[]
  permissions: string[]
  /**
   * Every office this user may act for — **the** office scope, and the only
   * thing authorization should read.
   *
   * The union of `user_offices` and the profile's primary `office_id`. The
   * union cannot over-grant, since the primary is itself a real assignment,
   * and it means a membership row that somehow went missing degrades to the
   * old single-office behaviour rather than locking someone out.
   *
   * Empty for a user with no office at all. `canViewAll` holders ignore it.
   */
  officeIds: string[]
  /** The same offices with their names, for pickers and labels. */
  offices: SessionOffice[]
  /** Convenience: this user may see requests from every office. */
  canViewAll: boolean
  /** From `auth.users` — only used as a fallback when the profile has none. */
  authEmail: string
  authAvatarUrl: string | null
}

/**
 * Everything the browser needs about the signed-in user, resolved once on the
 * server and handed to `SessionProvider`. Serializable — no Supabase client.
 */
export interface SessionSnapshot {
  userId: string
  email: string
  avatarUrl: string | null
  profile: SessionProfile
  roles: string[]
  permissions: string[]
  /** See `SessionContext.officeIds`. */
  officeIds: string[]
  offices: SessionOffice[]
}

/** Shape of the nested role → permission embed below. */
interface UserRoleRow {
  role: {
    code: string
    role_permissions: { permission: { code: string } | null }[] | null
  } | null
}

/**
 * Resolves the signed-in user's profile and effective permission codes.
 * Throws on anything that should abort the action — callers wrap in try/catch
 * and return `{ error }` rather than letting it reach the client.
 *
 * Wrapped in React `cache()`, so the whole auth chain runs **once per request**
 * no matter how many actions a page calls. Without this, a page that awaits
 * four actions paid for four `auth.getUser()` round trips plus four profile
 * lookups before a single row of real data was fetched.
 */
export const requireSession = cache(async function requireSession(): Promise<SessionContext> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error("Not signed in.")

  // Profile, roles, and office memberships are independent — one round trip,
  // not three. The roles query walks user_roles → roles → role_permissions →
  // permissions in a single PostgREST embed instead of a two-step fetch.
  const [{ data: profile }, { data: userRoles }, { data: userOffices }] =
    await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("user_profiles")
        .select(
          "id, full_name, email, position, avatar_url, office_id, is_active, office:offices(id, name, code, is_gso)"
        )
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .schema(SCHEMA)
        .from("user_roles")
        .select("role:roles(code, role_permissions(permission:permissions(code)))")
        .eq("user_id", user.id),
      supabase
        .schema(SCHEMA)
        .from("user_offices")
        .select("office:offices(id, name, code, is_gso)")
        .eq("user_id", user.id),
    ])

  if (!profile) throw new Error("No profile is registered for this account.")
  if (profile.is_active === false) throw new Error("This account is deactivated.")

  const rows = (userRoles ?? []) as unknown as UserRoleRow[]
  const roles = [...new Set(rows.map((r) => r.role?.code).filter(Boolean) as string[])]
  const permissions = [
    ...new Set(
      rows
        .flatMap((r) => r.role?.role_permissions ?? [])
        .map((rp) => rp.permission?.code)
        .filter(Boolean) as string[]
    ),
  ]

  const typedProfile = profile as unknown as SessionProfile

  // Union of the membership rows and the primary office, de-duplicated and
  // ordered with the primary first so pickers default to it. Including the
  // primary cannot widen access — it is itself an assignment — and it keeps a
  // profile whose membership row is missing working exactly as it did before.
  const officeById = new Map<string, SessionOffice>()
  if (typedProfile.office) {
    officeById.set(typedProfile.office.id, typedProfile.office)
  }
  for (const row of (userOffices ?? []) as unknown as {
    office: SessionOffice | null
  }[]) {
    if (row.office) officeById.set(row.office.id, row.office)
  }

  const offices = [...officeById.values()]

  return {
    supabase,
    userId: user.id,
    profile: typedProfile,
    roles,
    permissions,
    officeIds: offices.map((o) => o.id),
    offices,
    canViewAll: permissions.includes("request.view_all"),
    authEmail: user.email ?? "",
    authAvatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
  }
})

/**
 * Resolves the session for the browser. Returns `null` instead of throwing so
 * the dashboard layout can redirect rather than render an error boundary.
 *
 * This is what lets the client stop fetching its own auth state: previously
 * `useAuth`, `useProfile`, and every `usePermissions` call site each fired
 * their own requests on mount, so the sidebar and page actions popped in late.
 */
export async function getSessionSnapshot(): Promise<SessionSnapshot | null> {
  try {
    const ctx = await requireSession()
    return {
      userId: ctx.userId,
      email: ctx.profile.email || ctx.authEmail,
      avatarUrl: ctx.profile.avatar_url ?? ctx.authAvatarUrl,
      profile: ctx.profile,
      roles: ctx.roles,
      permissions: ctx.permissions,
      officeIds: ctx.officeIds,
      offices: ctx.offices,
    }
  } catch {
    return null
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
