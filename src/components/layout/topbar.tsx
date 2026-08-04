"use client"

import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/hooks/use-auth"
import { useProfile } from "@/lib/hooks/use-profile"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { NotificationBell } from "@/components/layout/notification-bell"
import { ChevronDown, LogOut, User } from "lucide-react"

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  requests: "Requests",
  new: "New",
  inventory: "Inventory",
  movements: "Stock Ledger",
  items: "Items",
  offices: "Offices",
  reports: "Reports",
  admin: "Admin",
  users: "Users",
  settings: "Settings",
  account: "Account",
}

function useBreadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)

  const crumbs: { label: string; href: string }[] = []
  let path = ""

  for (const segment of segments) {
    path += `/${segment}`
    const label = SEGMENT_LABELS[segment]
    if (!label) continue
    crumbs.push({ label, href: path })
  }

  return crumbs
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function Breadcrumbs() {
  const crumbs = useBreadcrumbs()

  if (crumbs.length === 0) return null

  return (
    <nav className="flex items-center gap-1 text-sm">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-muted-foreground select-none text-xs">/</span>
          )}
          <span
            className={
              i === crumbs.length - 1
                ? "font-semibold text-foreground"
                : "text-muted-foreground"
            }
          >
            {crumb.label}
          </span>
        </span>
      ))}
    </nav>
  )
}

export function Topbar() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { profile } = useProfile()

  const displayName = profile?.full_name || user?.email || "User"
  const displayEmail = profile?.email || user?.email || ""
  const initials = getInitials(displayName)
  const avatarUrl =
    profile?.avatar_url || user?.user_metadata?.avatar_url || undefined

  const shortName =
    displayName.length > 22 ? displayName.slice(0, 20) + "…" : displayName

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background/95 px-4 backdrop-blur-sm">
      {/* Collapse toggle — always visible */}
      <SidebarTrigger />

      {/* Separator */}
      <div className="h-5 w-px bg-border" />

      {/* Breadcrumbs */}
      <div className="flex-1">
        <Breadcrumbs />
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-0.5">
        {profile?.office && (
          <span className="mr-2 hidden max-w-[240px] truncate rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground lg:inline">
            {profile.office.code} · {profile.office.name}
          </span>
        )}

        <NotificationBell />

        <div className="mx-1 h-5 w-px bg-border" />

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            type="button"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-muted hover:text-foreground outline-none transition-colors"
          >
            <Avatar className="h-7 w-7">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-[10px] font-semibold bg-primary text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium md:block text-foreground">
              {shortName}
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground md:block" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="min-w-[230px]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="flex items-center gap-3 py-1">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={avatarUrl} alt={displayName} />
                    <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-semibold text-foreground leading-none">
                      {displayName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground leading-none">
                      {displayEmail}
                    </p>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => {
                router.push("/dashboard/account")
              }}
            >
              <User className="h-4 w-4" />
              Profile
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                void signOut()
              }}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
