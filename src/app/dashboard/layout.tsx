import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import { SessionProvider } from "@/lib/hooks/use-session"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getSessionSnapshot } from "@/lib/auth/session"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Resolved once here and shared through context. Layouts are not re-rendered
  // on client-side navigation, so this costs nothing per page change — and it
  // saves the browser from re-fetching auth, profile, and permissions on mount.
  const session = await getSessionSnapshot()
  if (!session) redirect("/auth")

  return (
    <SessionProvider session={session}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </SessionProvider>
  )
}
