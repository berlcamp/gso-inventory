"use client"

import { useSession } from "./use-session"
import type { SessionProfile } from "@/lib/auth/session"

export type Profile = SessionProfile

export function useProfile(): { profile: Profile | null; isLoading: boolean } {
  const { session } = useSession()
  return { profile: session?.profile ?? null, isLoading: false }
}
