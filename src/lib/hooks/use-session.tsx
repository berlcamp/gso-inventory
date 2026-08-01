"use client"

/**
 * Single source of truth for who the user is in the browser.
 *
 * The snapshot is resolved once on the server (dashboard layout) and handed
 * down as a prop — the client makes **no** auth requests of its own. Before
 * this, `useAuth`, `useProfile`, and every `usePermissions` call site fired
 * their own round trips on mount, so permission-gated buttons and the sidebar
 * flickered in after the page had already painted.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import type { SessionSnapshot } from "@/lib/auth/session"

export interface SessionUser {
  id: string
  email: string
  user_metadata: { avatar_url: string | null }
}

interface SessionContextValue {
  session: SessionSnapshot | null
  user: SessionUser | null
  signOut: () => Promise<void>
}

const SessionCtx = createContext<SessionContextValue>({
  session: null,
  user: null,
  signOut: async () => {},
})

export function SessionProvider({
  session,
  children,
}: {
  session: SessionSnapshot | null
  children: ReactNode
}) {
  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      user: session
        ? {
            id: session.userId,
            email: session.email,
            user_metadata: { avatar_url: session.avatarUrl },
          }
        : null,
      signOut: async () => {
        await createClient().auth.signOut()
        window.location.href = "/auth"
      },
    }),
    [session]
  )

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession() {
  return useContext(SessionCtx)
}
