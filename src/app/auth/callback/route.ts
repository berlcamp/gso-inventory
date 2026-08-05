import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { clearAuthCookies } from "@/lib/auth/cookies"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/dashboard"

  function redirect(path: string) {
    const forwardedHost = request.headers.get("x-forwarded-host")
    const isLocalEnv = process.env.NODE_ENV === "development"
    if (!isLocalEnv && forwardedHost) {
      return NextResponse.redirect(`https://${forwardedHost}${path}`)
    }
    return NextResponse.redirect(`${origin}${path}`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth?error=auth_callback_error`)
  }

  const supabase = await createClient()

  /**
   * Turns the sign-in away, and takes the session with it.
   *
   * `signOut()` alone is not enough: it writes the cookie expiry through
   * `next/headers`, not onto the `NextResponse` returned here, so a denied
   * account could keep a perfectly valid session. That is the redirect loop —
   * the proxy sees a signed-in user on `/auth`, sends them to `/dashboard`,
   * whose layout finds no usable profile and sends them back.
   */
  async function deny(error: string, detail?: string) {
    await supabase.auth.signOut()
    const target = new URL("/auth", origin)
    target.searchParams.set("error", error)
    if (detail) target.searchParams.set("detail", detail)
    const response = NextResponse.redirect(target)
    clearAuthCookies(
      response,
      (await cookies()).getAll().map((c) => c.name)
    )
    return response
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/auth?error=auth_callback_error`)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${origin}/auth?error=auth_callback_error`)
  }

  // Already provisioned — straight through.
  const { data: profile, error: profileError } = await supabase
    .schema("gso_inventory")
    .from("user_profiles")
    .select("id, is_active")
    .eq("id", user.id)
    .maybeSingle()

  // A failed lookup is NOT the same as "not registered" — surface it, otherwise
  // a missing schema exposure or grant looks identical to an unknown account.
  if (profileError) {
    console.error("[auth/callback] profile lookup failed:", profileError)
    return deny("lookup_failed", profileError.message)
  }

  if (profile) {
    if (profile.is_active === false) return deny("deactivated")
    return redirect(next)
  }

  // Pre-registered by an admin before this person ever signed in: the profile
  // carries a placeholder UUID keyed on email. Migrate it to the real auth UID.
  // Matched case-insensitively — Google may return a different casing than the
  // address the admin typed in.
  const { data: preRegistered, error: preRegisteredError } = await supabase
    .schema("gso_inventory")
    .from("user_profiles")
    .select("id, email")
    .ilike("email", user.email!)
    .maybeSingle()

  if (preRegisteredError) {
    console.error("[auth/callback] pre-registration lookup failed:", preRegisteredError)
    return deny("lookup_failed", preRegisteredError.message)
  }

  if (preRegistered && preRegistered.id !== user.id) {
    const { createAdminClient } = await import("@/lib/supabase/admin")
    const adminSupabase = createAdminClient()

    const { data: fullProfile } = await adminSupabase
      .from("user_profiles")
      .select("*")
      .eq("id", preRegistered.id)
      .single()

    if (fullProfile) {
      // Read both sets before the delete. `user_offices` cascades off the
      // profile row, so without carrying it over a user assigned to several
      // offices would silently lose all but their primary one the first time
      // they signed in — the assignment would look right in the admin screen
      // and be gone from the session.
      const [{ data: preRoles }, { data: preOffices }] = await Promise.all([
        adminSupabase
          .from("user_roles")
          .select("role_id")
          .eq("user_id", fullProfile.id),
        adminSupabase
          .from("user_offices")
          .select("office_id")
          .eq("user_id", fullProfile.id),
      ])

      await adminSupabase.from("user_roles").delete().eq("user_id", fullProfile.id)
      await adminSupabase.from("user_offices").delete().eq("user_id", fullProfile.id)
      await adminSupabase.from("user_profiles").delete().eq("id", fullProfile.id)

      await adminSupabase.from("user_profiles").insert({
        id: user.id,
        full_name:
          fullProfile.full_name || user.user_metadata?.full_name || user.email,
        email: user.email!.toLowerCase(),
        position: fullProfile.position,
        office_id: fullProfile.office_id,
        avatar_url: user.user_metadata?.avatar_url || fullProfile.avatar_url,
        is_active: fullProfile.is_active,
      })

      if (preRoles && preRoles.length > 0) {
        await adminSupabase.from("user_roles").insert(
          preRoles.map((r: { role_id: string }) => ({
            user_id: user.id,
            role_id: r.role_id,
          }))
        )
      }

      if (preOffices && preOffices.length > 0) {
        await adminSupabase.from("user_offices").insert(
          preOffices.map((o: { office_id: string }) => ({
            user_id: user.id,
            office_id: o.office_id,
          }))
        )
      }

      return redirect(next)
    }
  }

  // Not on file — no access.
  return deny("unauthorized")
}
