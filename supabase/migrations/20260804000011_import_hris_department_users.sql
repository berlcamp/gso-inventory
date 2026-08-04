-- Import the department-side users from the HRIS system.
--
-- HRIS (github.com/berlcamp/hris) lives in the SAME Supabase project as this
-- app — different schema, same database — so this reads `hris.user_profiles`
-- directly instead of transcribing a list of emails. Run it as the project
-- owner (Supabase SQL editor / `postgres`); a role without USAGE on `hris`
-- will fail on the first statement.
--
-- Role mapping — HRIS's two department-side roles onto this system's:
--
--   hris.department_admin  →  supply_officer   (files supply requests)
--   hris.department_head   →  department_head  (endorses what they file)
--   hris.department_admin_and_department_head → both
--
-- `office_id` is deliberately left NULL. HRIS department codes do not line up
-- one-for-one with `gso_inventory.offices` codes (CGSO/GSO, CVO/CVET,
-- SMLH/SMLMCGH, and CADMO/CEEO/CTRSMO have no exact match), so offices are
-- assigned afterwards from Dashboard → Admin → Users. There is an optional
-- mapping block at the bottom if you would rather do it in SQL.
--
-- Until a profile has an office it can do nothing harmful: a supply officer
-- with no office cannot file, and `canActForOffice` never matches a NULL
-- office, so a head cannot endorse another office's slip.
--
-- Each imported row is a placeholder UUID keyed on the Google email, exactly
-- like migrations 4/5/9. The auth callback swaps in the real `auth.users` ID
-- on that person's first sign-in.
--
-- Idempotent — re-applying skips profiles that already exist (by email) and
-- re-grants nothing.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Profiles
-- ───────────────────────────────────────────────────────────────────────────
-- Emails already present in gso_inventory are left completely untouched — an
-- existing profile keeps its name, position, and office.

WITH source AS (
  SELECT
    lower(h.email) AS email,
    h.full_name,
    h.avatar_url,
    h.role::text   AS hris_role
  FROM hris.user_profiles h
  WHERE h.is_active IS DISTINCT FROM false
    AND h.role::text IN (
      'department_admin',
      'department_head',
      'department_admin_and_department_head'
    )
),
inserted AS (
  INSERT INTO gso_inventory.user_profiles
    (id, office_id, email, full_name, position, avatar_url, is_active)
  SELECT
    gen_random_uuid(),
    NULL,                      -- assign the office from Admin → Users
    s.email,
    s.full_name,
    CASE s.hris_role
      WHEN 'department_admin' THEN 'Supply Officer'
      WHEN 'department_head'  THEN 'Department Head'
      ELSE 'Supply Officer / Department Head'
    END,
    s.avatar_url,
    true
  FROM source s
  ON CONFLICT (email) DO NOTHING
  RETURNING id
)
SELECT count(*) AS profiles_created FROM inserted;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Roles
-- ───────────────────────────────────────────────────────────────────────────
-- Driven off the same HRIS join rather than off `position`, so a profile that
-- already existed here gets its HRIS-derived role too without this migration
-- having to guess from a label someone may have edited. Purely additive: it
-- never removes a role, and `UNIQUE(user_id, role_id)` absorbs re-runs.
--
-- `h.role::text` avoids naming an enum value in SQL, so this parses even
-- against an HRIS schema that predates 'department_admin_and_department_head'.

INSERT INTO gso_inventory.user_roles (user_id, role_id)
SELECT up.id, r.id
FROM hris.user_profiles h
JOIN gso_inventory.user_profiles up
  ON up.email = lower(h.email)
CROSS JOIN LATERAL unnest(
  CASE h.role::text
    WHEN 'department_admin' THEN ARRAY['supply_officer']
    WHEN 'department_head'  THEN ARRAY['department_head']
    ELSE ARRAY['supply_officer', 'department_head']
  END
) AS m(code)
JOIN gso_inventory.roles r ON r.code = m.code
WHERE h.is_active IS DISTINCT FROM false
  AND h.role::text IN (
    'department_admin',
    'department_head',
    'department_admin_and_department_head'
  )
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. OPTIONAL — assign offices from the HRIS department code
-- ───────────────────────────────────────────────────────────────────────────
-- Uncomment to fill `office_id` for every imported profile whose HRIS
-- department maps to an office here. Only touches rows that still have no
-- office, so it can never overwrite an assignment made in the UI.
--
-- The first fourteen pairs are exact code matches. The last six are inferred
-- from the abbreviations and are the ones worth eyeballing before you run it;
-- CCO, CMO, and COS exist in HRIS but have no department users today.
--
WITH office_map (hris_code, gso_code) AS (
  VALUES
    ('CACCO',  'CACCO'),
    ('CAGRO',  'CAGRO'),
    ('CASSO',  'CASSO'),
    ('CBO',    'CBO'),
    ('CCRO',   'CCRO'),
    ('CEO',    'CEO'),
    ('CHO',    'CHO'),
    ('CHRMO',  'CHRMO'),
    ('CLO',    'CLO'),
    ('CPDO',   'CPDO'),
    ('CSWD',   'CSWD'),
    ('CTO',    'CTO'),
    ('SWEMO',  'SWEMO'),
    ('CMO',    'CMO'),
    -- inferred — confirm these read the way you expect:
    ('CGSO',   'GSO'),        -- City General Services Office
    ('CVO',    'CVET'),       -- City Veterinary Office
    ('SMLH',   'SMLMCGH'),    -- S.M. Lao Memorial City General Hospital
    ('CADMO',  'OCA'),        -- City Administrator's Office
    ('CEEO',   'EE-MALL'),    -- City Economic Enterprise Office
    ('CTRSMO', 'CTO-TOUR')    -- City Tourism Office
)
UPDATE gso_inventory.user_profiles up
SET office_id = o.id
FROM hris.user_profiles h
JOIN hris.departments d ON d.id = h.department_id
JOIN office_map m ON m.hris_code = d.code
JOIN gso_inventory.offices o ON o.code = m.gso_code
WHERE up.email = lower(h.email)
  AND up.office_id IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. What landed
-- ───────────────────────────────────────────────────────────────────────────
-- Every row with a blank office still needs one before that person can work:
-- a supply officer cannot file without it, and a head cannot endorse.

SELECT
  up.email,
  up.full_name,
  up.position,
  coalesce(o.code, '— assign office —') AS office,
  string_agg(r.code, ', ' ORDER BY r.code) AS roles
FROM gso_inventory.user_profiles up
JOIN hris.user_profiles h ON lower(h.email) = up.email
LEFT JOIN gso_inventory.offices o ON o.id = up.office_id
LEFT JOIN gso_inventory.user_roles ur ON ur.user_id = up.id
LEFT JOIN gso_inventory.roles r ON r.id = ur.role_id
WHERE h.role::text IN (
  'department_admin',
  'department_head',
  'department_admin_and_department_head'
)
GROUP BY up.id, o.code
ORDER BY (up.office_id IS NOT NULL), up.position, up.email;
