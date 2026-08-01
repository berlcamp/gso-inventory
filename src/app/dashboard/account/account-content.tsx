"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Loader2 } from "lucide-react"
import { useProfile } from "@/lib/hooks/use-profile"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { useAuth } from "@/lib/hooks/use-auth"

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm text-foreground">{value || "—"}</p>
    </div>
  )
}

export function AccountContent() {
  const { user } = useAuth()
  const { profile, isLoading } = useProfile()
  const { permissions, roles, loading } = usePermissions()

  if (isLoading || loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  const displayName = profile?.full_name ?? user?.email ?? "User"
  const avatarUrl =
    profile?.avatar_url ?? user?.user_metadata?.avatar_url ?? undefined

  return (
    <div className="grid max-w-4xl gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
          <Avatar className="h-20 w-20">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-base font-semibold">{displayName}</p>
            <p className="text-sm text-muted-foreground">
              {profile?.email ?? user?.email}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-1">
            {roles.length === 0 ? (
              <span className="text-xs text-muted-foreground">No roles</span>
            ) : (
              roles.map((role) => (
                <Badge key={role} variant="outline" className="text-xs">
                  {role}
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
            <Detail label="Full name" value={profile?.full_name} />
            <Detail label="Email" value={profile?.email} />
            <Detail label="Position" value={profile?.position} />
            <Detail
              label="Office"
              value={
                profile?.office
                  ? `${profile.office.code} — ${profile.office.name}`
                  : null
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Permissions
            </CardTitle>
            <CardDescription>
              What your roles allow you to do. Contact the GSO administrator to
              change these.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {permissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No permissions assigned yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {permissions.map((permission) => (
                  <span
                    key={permission}
                    className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {permission}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
