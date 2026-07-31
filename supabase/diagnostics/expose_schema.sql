-- ═══════════════════════════════════════════════════════════════════════════
-- Expose `gso_inventory` to the Data API from SQL.
--
-- PostgREST reads its configuration from settings on the `authenticator` role
-- (Supabase runs with in-database config enabled). This is the same knob the
-- dashboard's "Exposed schemas" field writes to — useful when that field will
-- not stick.
--
-- Run as the `postgres` user in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. What is configured right now? ──────────────────────────────────────
SELECT unnest(rolconfig) AS authenticator_setting
FROM pg_roles
WHERE rolname = 'authenticator';
-- Look for a `pgrst.db_schemas=...` line. If none appears, the value is coming
-- from the platform's own config rather than the role.


-- ── 2. Set the list ───────────────────────────────────────────────────────
-- This REPLACES the whole list, so every schema you still need must be here.
-- The list below is the one PostgREST reported, plus gso_inventory.
ALTER ROLE authenticator SET pgrst.db_schemas =
  'public, hris, civil_registrar, asenso, graphql_public, mtop, budget_tracker, website, gso_inventory';


-- ── 3. Make PostgREST pick it up ──────────────────────────────────────────
-- 'reload config' re-reads the role settings; 'reload schema' rebuilds the
-- cache of tables and columns. You need both.
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';


-- ── 4. Confirm it stuck ───────────────────────────────────────────────────
SELECT unnest(rolconfig) AS authenticator_setting
FROM pg_roles
WHERE rolname = 'authenticator';


-- ── 5. Sanity-check the grants the API needs ──────────────────────────────
-- Exposure alone is not enough; the API roles need schema and table access.
-- Migration 1 grants these — expect all true.
SELECT
  has_schema_privilege('authenticated', 'gso_inventory', 'USAGE')                 AS authenticated_usage,
  has_schema_privilege('anon',          'gso_inventory', 'USAGE')                 AS anon_usage,
  has_table_privilege ('authenticated', 'gso_inventory.user_profiles', 'SELECT')  AS authenticated_select;


-- ═══════════════════════════════════════════════════════════════════════════
-- Verify from outside Postgres — run in a terminal. A JSON array means the
-- schema is live; PGRST106 means it is still hidden.
--
--   curl -s \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--     -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--     -H "Accept-Profile: gso_inventory" \
--     "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/offices?select=code&limit=2"
--
-- Note: if the dashboard's "Exposed schemas" field is later saved again, it
-- overwrites this role setting. Add gso_inventory there too so the two agree.
-- ═══════════════════════════════════════════════════════════════════════════
