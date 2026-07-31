"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "./use-auth"

export function usePermissions() {
  const { user } = useAuth()
  const [permissions, setPermissions] = useState<string[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchPermissions = async () => {
      if (!user) {
        setPermissions([])
        setRoles([])
        setLoading(false)
        return
      }

      const { data: userRoles } = await supabase
        .schema("gso_inventory")
        .from("user_roles")
        .select("role_id, role:roles(code)")
        .eq("user_id", user.id)

      if (!userRoles || userRoles.length === 0) {
        setPermissions([])
        setRoles([])
        setLoading(false)
        return
      }

      const roleIds = userRoles.map((ur: { role_id: string }) => ur.role_id)
      setRoles(
        userRoles
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((ur: any) => (ur.role as { code: string } | null)?.code)
          .filter(Boolean) as string[]
      )

      const { data: rolePerms } = await supabase
        .schema("gso_inventory")
        .from("role_permissions")
        .select("permission:permissions(code)")
        .in("role_id", roleIds)

      const permCodes = (rolePerms ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((rp: any) => (rp.permission as { code: string } | null)?.code)
        .filter(Boolean) as string[]

      setPermissions([...new Set(permCodes)])
      setLoading(false)
    }

    fetchPermissions()
  }, [user, supabase])

  const can = (permission: string) => permissions.includes(permission)
  const canAny = (...perms: string[]) => perms.some((p) => permissions.includes(p))
  const canAll = (...perms: string[]) => perms.every((p) => permissions.includes(p))
  const hasRole = (...codes: string[]) => codes.some((c) => roles.includes(c))

  return { permissions, roles, loading, can, canAny, canAll, hasRole }
}
