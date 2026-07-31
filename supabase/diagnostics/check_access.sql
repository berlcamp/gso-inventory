-- ═══════════════════════════════════════════════════════════════════════════
-- "Access Denied" diagnostics — run this in the Supabase SQL editor.
--
-- The login callback denies access when it cannot find a profile matching the
-- signed-in Google account. Work down the checks: the first one that comes back
-- wrong is the cause.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Did every migration actually apply? ────────────────────────────────
-- Expect: 15 tables, 3 functions, 28 offices, 390 items, 4 roles.
-- Zero offices means migration 3 never ran — and migration 4 silently inserts
-- NOTHING in that case, because it looks up the GSO office by code.
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'gso_inventory')                        AS tables,
  (SELECT count(*) FROM information_schema.routines
     WHERE routine_schema = 'gso_inventory')                      AS functions,
  (SELECT count(*) FROM gso_inventory.offices)                    AS offices,
  (SELECT count(*) FROM gso_inventory.items)                      AS items,
  (SELECT count(*) FROM gso_inventory.roles)                      AS roles,
  (SELECT count(*) FROM gso_inventory.user_profiles)              AS profiles;


-- ── 2. Who has actually signed in, and does a profile match? ──────────────
-- The OAuth exchange succeeds before the profile check, so your account IS in
-- auth.users even though you were denied.
--   match_by_id    = true  → you should already have access
--   match_by_email = true  → first login migrates the placeholder; also fine
--   both false             → this is the problem (go to the FIX below)
SELECT
  u.email                                   AS auth_email,
  u.id                                      AS auth_uid,
  p_id.email  IS NOT NULL                   AS match_by_id,
  p_mail.id   IS NOT NULL                   AS match_by_email,
  p_mail.id                                 AS profile_uid_if_email_match,
  p_mail.is_active                          AS profile_active
FROM auth.users u
LEFT JOIN gso_inventory.user_profiles p_id   ON p_id.id = u.id
LEFT JOIN gso_inventory.user_profiles p_mail ON lower(p_mail.email) = lower(u.email)
ORDER BY u.created_at DESC;


-- ── 3. Hidden whitespace or case mismatch in the seeded email ─────────────
-- The callback matches on exact email. Brackets expose stray spaces.
SELECT id, '[' || email || ']' AS email_exact, length(email) AS len,
       full_name, is_active
FROM gso_inventory.user_profiles;


-- ── 4. Is the FK to auth.users still in place? ────────────────────────────
-- Migration 4 drops it so placeholder profiles are allowed. If it is still
-- there, the placeholder INSERT failed and no profile was created.
SELECT conname AS fk_still_present
FROM pg_constraint
WHERE conrelid = 'gso_inventory.user_profiles'::regclass
  AND contype = 'f'
  AND conname = 'user_profiles_id_fkey';
-- Expect: 0 rows.


-- ── 5. Can the `authenticated` role actually read the table? ──────────────
-- Missing grants or a missing SELECT policy make the lookup return nothing,
-- which the app reports as "Access Denied".
SELECT
  has_schema_privilege('authenticated', 'gso_inventory', 'USAGE')             AS schema_usage,
  has_table_privilege('authenticated', 'gso_inventory.user_profiles', 'SELECT') AS can_select,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'gso_inventory'
       AND tablename = 'user_profiles'
       AND cmd = 'SELECT')                                                    AS select_policies;
-- Expect: true, true, 1


-- ── 6. Roles attached to each profile ─────────────────────────────────────
SELECT p.email, r.code AS role
FROM gso_inventory.user_profiles p
LEFT JOIN gso_inventory.user_roles ur ON ur.user_id = p.id
LEFT JOIN gso_inventory.roles r ON r.id = ur.role_id
ORDER BY p.email;


-- ═══════════════════════════════════════════════════════════════════════════
-- FIX — run this once you have signed in at least once (so auth.users has you).
-- It binds the profile directly to your real auth UID, skipping the placeholder
-- dance entirely. Change the email on the first line only.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_email TEXT := 'berlcamp@gmail.com';   -- << your Google email
  v_uid   UUID;
  v_office UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(v_email);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No auth.users row for % — sign in with Google once first, then re-run.', v_email;
  END IF;

  SELECT id INTO v_office FROM gso_inventory.offices WHERE code = 'GSO';
  IF v_office IS NULL THEN
    RAISE EXCEPTION 'No GSO office — migration 20260731000003 (baseline inventory) has not been applied.';
  END IF;

  -- Clear out any placeholder profile seeded under a different UUID.
  DELETE FROM gso_inventory.user_roles
   WHERE user_id IN (SELECT id FROM gso_inventory.user_profiles
                      WHERE lower(email) = lower(v_email) AND id <> v_uid);
  DELETE FROM gso_inventory.user_profiles
   WHERE lower(email) = lower(v_email) AND id <> v_uid;

  INSERT INTO gso_inventory.user_profiles (id, email, full_name, position, office_id, is_active)
  VALUES (v_uid, lower(v_email), 'System Administrator', 'System Administrator', v_office, true)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, is_active = true, office_id = EXCLUDED.office_id;

  INSERT INTO gso_inventory.user_roles (user_id, role_id)
  SELECT v_uid, r.id FROM gso_inventory.roles r WHERE r.code = 'admin'
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Linked % to auth uid % with the admin role.', v_email, v_uid;
END $$;


-- Confirm the fix took.
SELECT p.id, p.email, p.is_active, o.code AS office, r.code AS role
FROM gso_inventory.user_profiles p
LEFT JOIN gso_inventory.offices o ON o.id = p.office_id
LEFT JOIN gso_inventory.user_roles ur ON ur.user_id = p.id
LEFT JOIN gso_inventory.roles r ON r.id = ur.role_id
WHERE p.id IN (SELECT id FROM auth.users);
