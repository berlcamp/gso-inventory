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
  const result = await getSessionSnapshot()

  // Not signed in at all is the proxy's business and needs no explanation.
  // Anything else means a live Google session the app cannot use, so it goes
  // through sign-out: leaving the cookie in place would put the proxy and this
  // layout in a redirect loop, each sending the user to the other's page.
  if (!result.session) {
    if (result.reason === "unauthenticated") redirect("/auth")
    const params = new URLSearchParams({ reason: result.reason })
    if (result.detail) params.set("detail", result.detail)
    redirect(`/auth/signout?${params}`)
  }

  const session = result.session

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
