"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "./use-auth"
import React from "react"

interface ProfileOffice {
  id: string
  name: string
  code: string
  is_gso: boolean
}

interface Profile {
  id: string
  full_name: string
  email: string
  position: string | null
  avatar_url: string | null
  office_id: string | null
  office: ProfileOffice | null
}

interface ProfileContextType {
  profile: Profile | null
  isLoading: boolean
}

const ProfileContext = createContext<ProfileContextType>({
  profile: null,
  isLoading: true,
})

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) {
        setProfile(null)
        setIsLoading(false)
        return
      }

      const { data } = await supabase
        .schema("gso_inventory")
        .from("user_profiles")
        .select(
          "id, full_name, email, position, avatar_url, office_id, office:offices(id, name, code, is_gso)"
        )
        .eq("id", user.id)
        .maybeSingle()

      setProfile(data as unknown as Profile)
      setIsLoading(false)
    }

    fetchProfile()
  }, [user, supabase])

  return React.createElement(
    ProfileContext.Provider,
    { value: { profile, isLoading } },
    children
  )
}

export function useProfile() {
  return useContext(ProfileContext)
}
