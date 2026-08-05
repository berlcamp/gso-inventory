"use server"

import { revalidatePath } from "next/cache"
import { randomUUID } from "crypto"
import { requirePermission, toError, SCHEMA } from "@/lib/auth/session"
import { createAdminClient } from "@/lib/supabase/admin"
import { userSchema, userUpdateSchema } from "@/lib/schemas/gso"
import type { ActionResult, Role, UserProfileRow } from "@/types/database"

/**
 * The offices a user acts for, primary always included.
 *
 * Normalizing here rather than trusting the form keeps the primary and the
 * membership set from ever disagreeing — `SessionContext.officeIds` unions the
 * two, so a primary missing from the set would silently still grant access and
 * the admin screen would be lying about it.
 *
 * Not exported: a `"use server"` module may only export async functions.
 */
function officeSet(
  primary: string | null,
  extra: string[]
): string[] {
  return [...new Set([...(primary ? [primary] : []), ...extra])]
}

export async function getUsers(): Promise<ActionResult<UserProfileRow[]>> {
  try {
    const ctx = await requirePermission("admin.manage")

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("user_profiles")
      .select(
        "*, office:offices!office_id(id, name, code), user_roles(id, role_id, role:roles(id, name, code, description)), user_offices(office_id, office:offices!office_id(id, name, code))"
      )
      .order("created_at", { ascending: false })

    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as unknown as UserProfileRow[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function getRoles(): Promise<ActionResult<Role[]>> {
  try {
    const ctx = await requirePermission("admin.manage")

    const { data, error } = await ctx.supabase
      .schema(SCHEMA)
      .from("roles")
      .select("*")
      .order("name")

    if (error) return { error: error.message, data: [] }
    return { error: null, data: (data ?? []) as Role[] }
  } catch (e) {
    return { error: toError(e), data: [] }
  }
}

export async function addUser(input: unknown): Promise<ActionResult> {
  try {
    await requirePermission("admin.manage")
    const parsed = userSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0].message, data: null }
    const values = parsed.data

    const adminSupabase = createAdminClient()

    const { data: existing } = await adminSupabase
      .from("user_profiles")
      .select("id")
      .eq("email", values.email)
      .maybeSingle()

    if (existing) return { error: "A user with this email already exists.", data: null }

    // Placeholder UUID — the auth callback swaps in the real auth.users id
    // (matched by email) the first time this person signs in with Google.
    const placeholderId = randomUUID()

    const { error: profileError } = await adminSupabase.from("user_profiles").insert({
      id: placeholderId,
      email: values.email,
      full_name: values.full_name,
      position: values.position ?? null,
      office_id: values.office_id,
    })

    if (profileError) return { error: profileError.message, data: null }

    if (values.role_ids.length > 0) {
      const { error: roleError } = await adminSupabase.from("user_roles").insert(
        values.role_ids.map((roleId) => ({
          user_id: placeholderId,
          role_id: roleId,
        }))
      )
      if (roleError) return { error: roleError.message, data: null }
    }

    const offices = officeSet(values.office_id, values.office_ids)
    if (offices.length > 0) {
      const { error: officeError } = await adminSupabase
        .from("user_offices")
        .insert(
          offices.map((officeId) => ({
            user_id: placeholderId,
            office_id: officeId,
          }))
        )
      if (officeError) return { error: officeError.message, data: null }
    }

    revalidatePath("/dashboard/admin/users")
    revalidatePath("/dashboard/offices")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

export async function updateUser(
  userId: string,
  input: unknown
): Promise<ActionResult> {
  try {
    await requirePermission("admin.manage")
    const parsed = userUpdateSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0].message, data: null }
    const values = parsed.data

    const adminSupabase = createAdminClient()

    const { error: profileError } = await adminSupabase
      .from("user_profiles")
      .update({
        full_name: values.full_name,
        position: values.position ?? null,
        office_id: values.office_id,
      })
      .eq("id", userId)

    if (profileError) return { error: profileError.message, data: null }

    // Replace the role set wholesale.
    await adminSupabase.from("user_roles").delete().eq("user_id", userId)

    if (values.role_ids.length > 0) {
      const { error: roleError } = await adminSupabase.from("user_roles").insert(
        values.role_ids.map((roleId) => ({ user_id: userId, role_id: roleId }))
      )
      if (roleError) return { error: roleError.message, data: null }
    }

    // Same for the offices — replacing wholesale is what makes un-assigning an
    // office possible at all.
    await adminSupabase.from("user_offices").delete().eq("user_id", userId)

    const offices = officeSet(values.office_id, values.office_ids)
    if (offices.length > 0) {
      const { error: officeError } = await adminSupabase
        .from("user_offices")
        .insert(
          offices.map((officeId) => ({ user_id: userId, office_id: officeId }))
        )
      if (officeError) return { error: officeError.message, data: null }
    }

    revalidatePath("/dashboard/admin/users")
    revalidatePath("/dashboard/offices")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}

/**
 * Deactivating keeps the audit trail intact (requests reference the profile),
 * which is why there is no hard delete here.
 */
export async function setUserActive(
  userId: string,
  isActive: boolean
): Promise<ActionResult> {
  try {
    const ctx = await requirePermission("admin.manage")

    if (userId === ctx.userId && !isActive) {
      return { error: "You cannot deactivate your own account.", data: null }
    }

    const adminSupabase = createAdminClient()
    const { error } = await adminSupabase
      .from("user_profiles")
      .update({ is_active: isActive })
      .eq("id", userId)

    if (error) return { error: error.message, data: null }

    revalidatePath("/dashboard/admin/users")
    return { error: null, data: null }
  } catch (e) {
    return { error: toError(e), data: null }
  }
}
