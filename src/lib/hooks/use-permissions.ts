"use client"

import { useSession } from "./use-session"

/**
 * Permission codes arrive with the page, so `can(...)` is already correct on
 * the first render — no window where a permission-gated button is missing and
 * then pops in. `loading` is kept in the return shape for existing call sites.
 */
export function usePermissions() {
  const { session } = useSession()
  const permissions = session?.permissions ?? []
  const roles = session?.roles ?? []

  return {
    permissions,
    /** Role codes — what `hasRole` and every gate compares against. */
    roles,
    /** The same roles as display labels, for showing a person their access. */
    roleNames: session?.roleNames ?? [],
    loading: false,
    can: (permission: string) => permissions.includes(permission),
    canAny: (...perms: string[]) => perms.some((p) => permissions.includes(p)),
    canAll: (...perms: string[]) => perms.every((p) => permissions.includes(p)),
    hasRole: (...codes: string[]) => codes.some((c) => roles.includes(c)),
  }
}
