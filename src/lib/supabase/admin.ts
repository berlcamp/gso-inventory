import { createClient } from "@supabase/supabase-js"

/** Decode JWT payload (no crypto verify) to catch anon key mislabeled as service role. */
function assertServiceRoleJwt(key: string) {
  const parts = key.split(".")
  if (parts.length < 2) return
  let b64 = parts[1]
  const pad = (4 - (b64.length % 4)) % 4
  if (pad) b64 += "=".repeat(pad)
  try {
    const json = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    )
    const payload = JSON.parse(json) as { role?: string }
    if (payload.role && payload.role !== "service_role") {
      throw new Error(
        `SUPABASE_SERVICE_ROLE_KEY must be the service_role secret from Supabase (Settings → API). This key has JWT role "${payload.role}" (the anon key causes "permission denied" on inserts).`
      )
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("SUPABASE_SERVICE_ROLE_KEY must")) throw e
  }
}

export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set")
  }

  assertServiceRoleJwt(serviceRoleKey)

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: "gso_inventory",
    },
  })
}
