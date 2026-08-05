import type { NextResponse } from "next/server"

/**
 * Clears the Supabase session cookies on the response actually being returned.
 *
 * `supabase.auth.signOut()` writes its expiry through the client's `setAll`,
 * which lands in `next/headers`' mutable cookie store — a different channel
 * from the `NextResponse` a route handler constructs and returns. Rather than
 * rely on the two being merged, every path that denies access clears the
 * cookies on its own response.
 *
 * A session that outlives its sign-out is not cosmetic here: the proxy would
 * still see an authenticated user, bounce them off `/auth` into `/dashboard`,
 * and the dashboard layout would bounce them back — ERR_TOO_MANY_REDIRECTS
 * instead of the page explaining why they were turned away.
 *
 * Supabase stores the session as `sb-<project-ref>-auth-token`, chunked into
 * `.0`, `.1`, … when it outgrows one cookie, so this matches on the prefix
 * rather than a known name.
 */
export function clearAuthCookies(
  response: NextResponse,
  names: Iterable<string>
) {
  for (const name of names) {
    if (name.startsWith("sb-")) response.cookies.delete(name)
  }
}
