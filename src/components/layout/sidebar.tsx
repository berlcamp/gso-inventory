"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { usePermissions } from "@/lib/hooks/use-permissions"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  Warehouse,
  LayoutDashboard,
  ClipboardList,
  Boxes,
  Tags,
  Building2,
  ArrowLeftRight,
  BarChart3,
  Users,
  Settings,
} from "lucide-react"

interface NavItem {
  title: string
  href: string
  icon: React.ElementType
  permissions?: string[]
}

const navItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    title: "Requests",
    href: "/dashboard/requests",
    icon: ClipboardList,
    permissions: ["request.view", "request.create"],
  },
  {
    title: "Inventory",
    href: "/dashboard/inventory",
    icon: Boxes,
    permissions: ["inventory.view"],
  },
  {
    title: "Stock Ledger",
    href: "/dashboard/movements",
    icon: ArrowLeftRight,
    permissions: ["inventory.view"],
  },
  {
    title: "Reports",
    href: "/dashboard/reports",
    icon: BarChart3,
    permissions: ["reports.view"],
  },
]

const catalogItems: NavItem[] = [
  {
    title: "Items",
    href: "/dashboard/items",
    icon: Tags,
    permissions: ["item.manage"],
  },
  {
    title: "Offices",
    href: "/dashboard/offices",
    icon: Building2,
    permissions: ["office.manage"],
  },
]

const adminItems: NavItem[] = [
  {
    title: "Users",
    href: "/dashboard/admin/users",
    icon: Users,
    permissions: ["admin.manage"],
  },
  {
    title: "Settings",
    href: "/dashboard/admin/settings",
    icon: Settings,
    permissions: ["admin.manage"],
  },
]

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname()
  const isActive =
    item.href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(item.href)

  return (
    <SidebarMenuItem>
      <Link
        href={item.href}
        className={cn(
          "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all relative",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
            : "text-sidebar-foreground hover:bg-sidebar-hover"
        )}
      >
        {/* Blue active indicator */}
        <span
          className={cn(
            "absolute left-0 inset-y-1.5 w-0.5 rounded-r-full transition-all bg-sidebar-primary",
            isActive ? "opacity-100" : "opacity-0"
          )}
        />
        <item.icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            isActive
              ? "text-sidebar-accent-foreground"
              : "text-sidebar-muted-foreground group-hover:text-sidebar-foreground"
          )}
        />
        <span>{item.title}</span>
      </Link>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const { canAny } = usePermissions()

  const filter = (items: NavItem[]) =>
    items.filter((item) => !item.permissions || canAny(...item.permissions))

  const filteredNavItems = filter(navItems)
  const filteredCatalogItems = filter(catalogItems)
  const filteredAdminItems = filter(adminItems)

  return (
    <Sidebar>
      {/* Logo */}
      <SidebarHeader>
        <div className="flex h-14 items-center gap-3 border-b border-sidebar-border px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary">
            <Warehouse className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-sidebar-foreground tracking-wide">
              RIS &amp; INVENTORY
            </p>
            <p className="truncate text-[10px] leading-tight text-sidebar-muted-foreground tracking-wide">
              Ozamiz City
            </p>
          </div>
        </div>
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {filteredNavItems.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {filteredCatalogItems.length > 0 && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Master Data</SidebarGroupLabel>
              <SidebarMenu>
                {filteredCatalogItems.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}

        {filteredAdminItems.length > 0 && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Admin</SidebarGroupLabel>
              <SidebarMenu>
                {filteredAdminItems.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
    </Sidebar>
  )
}
