import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { clearAuthCookies } from "@/lib/auth/cookies"
import { isSessionFailure } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"

/**
 * Ends a session that cannot be used, and says why on the way out.
 *
 * The dashboard layout sends people here when the session will not resolve — a
 * valid Google session whose profile is missing, deactivated, or unreadable. A
 * Server Component cannot clear a cookie, so a layout can only redirect; with
 * nowhere that actually signs the user out, they would arrive back at `/auth`
 * still authenticated, and the only thing they could do there is sign in again
 * into the same dead end.
 *
 * Also the topbar's sign-out target would be, if it ever needs a server one.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url)

  const supabase = await createClient()
  await supabase.auth.signOut()

  const target = new URL("/auth", origin)

  // Only codes the login page knows how to render get echoed back. The reason
  // arrives in a URL anyone can type, and `detail` is displayed verbatim.
  const reason = searchParams.get("reason")
  if (isSessionFailure(reason)) {
    target.searchParams.set("error", reason)
    const detail = searchParams.get("detail")
    if (detail && reason === "lookup_failed") {
      target.searchParams.set("detail", detail.slice(0, 300))
    }
  }

  const response = NextResponse.redirect(target)
  clearAuthCookies(
    response,
    (await cookies()).getAll().map((c) => c.name)
  )
  return response
}
