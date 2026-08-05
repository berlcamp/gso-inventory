/**
 * Server-side session helpers shared by every server action.
 *
 * Kept out of the `"use server"` action files on purpose — those may only
 * export async functions, so non-action exports (types, constants) live here.
 */

import { cache } from "react"
import { createClient } from "@/lib/supabase/server"

export const SCHEMA = "gso_inventory" as const

/**
 * Why a session could not be resolved. These are the codes `/auth` renders, so
 * a user turned away is told which of the four it was rather than "please try
 * again" — the fixes are different and only one of them is theirs.
 */
export const SESSION_FAILURES = [
  "unauthenticated",
  "unauthorized",
  "deactivated",
  "lookup_failed",
] as const

export type SessionFailure = (typeof SESSION_FAILURES)[number]

export function isSessionFailure(value: string | null): value is SessionFailure {
  return (SESSION_FAILURES as readonly string[]).includes(value ?? "")
}

/** An `Error` that also says which failure it was, for the redirect target. */
export class SessionError extends Error {
  readonly reason: SessionFailure

  constructor(reason: SessionFailure, message: string) {
    super(message)
    this.name = "SessionError"
    this.reason = reason
  }
}

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
  /**
   * The display names of `roles`, in the same order — "GSO Head", not
   * `gso_head`. Read from the `roles` table rather than derived from the code,
   * so a role added by a later migration labels itself instead of falling
   * through a map nobody remembered to extend.
   */
  roleNames: string[]
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
  /** See `SessionContext.roleNames`. */
  roleNames: string[]
  permissions: string[]
  /** See `SessionContext.officeIds`. */
  officeIds: string[]
  offices: SessionOffice[]
}

/** Shape of the nested role → permission embed below. */
interface UserRoleRow {
  role: {
    code: string
    name: string | null
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

  if (!user) throw new SessionError("unauthenticated", "Not signed in.")

  // Profile, roles, and office memberships are independent — one round trip,
  // not three. The roles query walks user_roles → roles → role_permissions →
  // permissions in a single PostgREST embed instead of a two-step fetch.
  //
  // `offices!office_id` names the foreign key on purpose. `user_offices` is a
  // junction table by PostgREST's reckoning — two foreign keys, and a primary
  // key made of exactly those two columns — so it exposes a second, many-to-many
  // route from `user_profiles` to `offices` alongside the direct `office_id`
  // column. Without the hint the embed is ambiguous and the query fails
  // outright with "more than one relationship was found", taking the whole
  // session down with it. Every other embed in the codebase already names its
  // key; this was the one that did not.
  const [
    { data: profile, error: profileError },
    { data: userRoles },
    { data: userOffices },
  ] = await Promise.all([
      supabase
        .schema(SCHEMA)
        .from("user_profiles")
        .select(
          "id, full_name, email, position, avatar_url, office_id, is_active, office:offices!office_id(id, name, code, is_gso)"
        )
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .schema(SCHEMA)
        .from("user_roles")
        .select(
          "role:roles(code, name, role_permissions(permission:permissions(code)))"
        )
        .eq("user_id", user.id),
      supabase
        .schema(SCHEMA)
        .from("user_offices")
        .select("office:offices!office_id(id, name, code, is_gso)")
        .eq("user_id", user.id),
    ])

  // A failed query is not the same as "not registered". A missing schema
  // exposure or a revoked grant returns no row either, and telling someone
  // their account is unauthorized when the database is simply unreachable
  // sends them to the administrator to fix an account that is already fine.
  // The auth callback already draws this line; this is the same distinction
  // on the path every other request takes.
  if (profileError) throw new SessionError("lookup_failed", profileError.message)

  if (!profile) {
    throw new SessionError(
      "unauthorized",
      "No profile is registered for this account."
    )
  }
  if (profile.is_active === false) {
    throw new SessionError("deactivated", "This account is deactivated.")
  }

  const rows = (userRoles ?? []) as unknown as UserRoleRow[]
  // One pass keyed by code, so `roles` and `roleNames` cannot drift out of
  // alignment: a Set of codes plus a separately-mapped list of names would
  // mislabel every role after the first duplicate.
  const roleNameByCode = new Map<string, string>()
  for (const row of rows) {
    if (!row.role?.code) continue
    roleNameByCode.set(row.role.code, row.role.name || row.role.code)
  }
  const roles = [...roleNameByCode.keys()]
  const roleNames = [...roleNameByCode.values()]
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
    roleNames,
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
 * The session, or why there isn't one. Carrying the reason out is what lets
 * the layout send someone to a page that explains itself: a bare redirect to
 * `/auth` tells a deactivated user, an unregistered one, and one whose
 * database is unreachable exactly the same nothing.
 */
export type SessionResult =
  | { session: SessionSnapshot; reason?: never; detail?: never }
  | { session: null; reason: SessionFailure; detail?: string }

/**
 * Resolves the session for the browser. Returns a result instead of throwing
 * so the dashboard layout can redirect rather than render an error boundary.
 *
 * This is what lets the client stop fetching its own auth state: previously
 * `useAuth`, `useProfile`, and every `usePermissions` call site each fired
 * their own requests on mount, so the sidebar and page actions popped in late.
 */
export async function getSessionSnapshot(): Promise<SessionResult> {
  try {
    const ctx = await requireSession()
    return {
      session: {
        userId: ctx.userId,
        email: ctx.profile.email || ctx.authEmail,
        avatarUrl: ctx.profile.avatar_url ?? ctx.authAvatarUrl,
        profile: ctx.profile,
        roles: ctx.roles,
        roleNames: ctx.roleNames,
        permissions: ctx.permissions,
        officeIds: ctx.officeIds,
        offices: ctx.offices,
      },
    }
  } catch (e) {
    // Anything that is not a recognised session failure got as far as a live
    // query and came back broken, so it is reported as one — with the message,
    // which is usually the only clue about what the database refused.
    const reason = e instanceof SessionError ? e.reason : "lookup_failed"
    return {
      session: null,
      reason,
      detail: reason === "lookup_failed" ? toError(e) : undefined,
    }
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
