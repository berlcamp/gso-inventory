import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { clearAuthCookies } from "@/lib/auth/cookies"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  // Clear stale auth cookies when the refresh token is invalid/missing.
  // Without this, every request re-throws the same AuthApiError until the
  // cookies expire. Applied to whichever response is returned below — putting
  // it only on `supabaseResponse` dropped it on exactly the requests that hit
  // it, since an unauthenticated `/dashboard` request returns a redirect
  // instead and the deletions went out with the discarded response.
  const stale =
    error?.code === "refresh_token_not_found" ||
    error?.code === "refresh_token_already_used"

  function finish(response: NextResponse) {
    if (stale) {
      clearAuthCookies(
        response,
        request.cookies.getAll().map((c) => c.name)
      )
    }
    return response
  }

  // Redirect unauthenticated users to the login page.
  //
  // `/print` is guarded alongside `/dashboard` because it is the same data
  // behind a different layout — the printable delivery receipt lives outside
  // `/dashboard` only so it renders as a clean sheet, not because it is any
  // more public. Its action re-checks visibility server-side regardless; this
  // just means a signed-out person gets the login page instead of an error.
  const guarded =
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/print")

  if (!user && !request.nextUrl.pathname.startsWith("/auth") && guarded) {
    const url = request.nextUrl.clone()
    url.pathname = "/auth"
    return finish(NextResponse.redirect(url))
  }

  // Redirect authenticated users away from the login page — but only the login
  // page itself, and only when it is not reporting why signing in failed.
  //
  // Both conditions are load-bearing. `/auth/callback` and `/auth/signout` are
  // the routes that *establish* and *clear* the session, so bouncing them would
  // throw away the OAuth code and strand the cookie respectively. And an
  // account with a valid Google session but no usable profile lands on
  // `/auth?error=…`: bouncing it sends it to `/dashboard`, whose layout finds
  // no profile and sends it straight back here — a redirect loop the browser
  // ends with ERR_TOO_MANY_REDIRECTS, in place of the message that would have
  // told the person what to do about it.
  if (
    user &&
    request.nextUrl.pathname === "/auth" &&
    !request.nextUrl.searchParams.has("error")
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return finish(NextResponse.redirect(url))
  }

  return finish(supabaseResponse)
}
