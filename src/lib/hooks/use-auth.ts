"use client"

import { useSession } from "./use-session"

/**
 * Reads the server-resolved session. Kept as a hook (rather than folding call
 * sites into `useSession`) so existing `const { user, signOut } = useAuth()`
 * usage keeps working — it just no longer costs a network round trip on mount.
 */
export function useAuth() {
  const { user, signOut } = useSession()
  return { user, loading: false, signOut }
}
