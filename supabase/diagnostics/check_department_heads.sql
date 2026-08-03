-- Verifies the department head endorsement stage (migrations 7–9) and shows
-- which offices can actually file right now.
--
-- Run in the Supabase SQL editor. Section 4 is the one that matters
-- operationally: every office listed there has a supply officer who cannot
-- submit anything, because `createRequest` refuses when the office has no
-- active department head to endorse the slip.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Did migration 7 land? Expect 'awaiting_endorsement' and 'endorsed'.
-- ───────────────────────────────────────────────────────────────────────────

SELECT t.typname AS enum_type, e.enumlabel AS value, e.enumsortorder AS ord
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'gso_inventory'
  AND t.typname IN ('request_status', 'request_action')
ORDER BY t.typname, e.enumsortorder;

-- Columns + the migration 8 default. `column_default` must read
-- 'awaiting_endorsement'::gso_inventory.request_status.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'gso_inventory'
  AND table_name = 'requests'
  AND column_name IN ('status', 'endorsed_by', 'endorsed_at')
ORDER BY column_name;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. The role and its permissions. Expect exactly three:
--    inventory.view, request.endorse, request.view — and NOT request.create.
-- ───────────────────────────────────────────────────────────────────────────

SELECT r.code AS role, p.code AS permission
FROM gso_inventory.roles r
JOIN gso_inventory.role_permissions rp ON rp.role_id = r.id
JOIN gso_inventory.permissions p ON p.id = rp.permission_id
WHERE r.code = 'department_head'
ORDER BY p.code;

-- admin must have picked up request.endorse from migration 7's re-run cross
-- join. One row expected.
SELECT count(*) AS admin_has_endorse
FROM gso_inventory.roles r
JOIN gso_inventory.role_permissions rp ON rp.role_id = r.id
JOIN gso_inventory.permissions p ON p.id = rp.permission_id
WHERE r.code = 'admin' AND p.code = 'request.endorse';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Who currently holds the role.
-- ───────────────────────────────────────────────────────────────────────────

SELECT o.code AS office, up.full_name, up.email, up.is_active
FROM gso_inventory.user_profiles up
JOIN gso_inventory.user_roles ur ON ur.user_id = up.id
JOIN gso_inventory.roles r ON r.id = ur.role_id
LEFT JOIN gso_inventory.offices o ON o.id = up.office_id
WHERE r.code = 'department_head'
ORDER BY o.code NULLS FIRST;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. ►► Offices that CANNOT FILE — no active department head to endorse.
--    Fix from Dashboard → Admin → Users, or by filling in migration 9.
-- ───────────────────────────────────────────────────────────────────────────

SELECT o.code, o.name
FROM gso_inventory.offices o
WHERE o.is_active
  AND NOT EXISTS (
    SELECT 1
    FROM gso_inventory.user_profiles up
    JOIN gso_inventory.user_roles ur ON ur.user_id = up.id
    JOIN gso_inventory.roles r ON r.id = ur.role_id
    WHERE up.office_id = o.id
      AND up.is_active
      AND r.code = 'department_head'
  )
ORDER BY o.code;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Where existing requests sit. Requests filed before migration 7 keep
--    'pending', which still means "on GSO's desk" — no backfill is needed.
-- ───────────────────────────────────────────────────────────────────────────

SELECT status, count(*) AS requests
FROM gso_inventory.requests
GROUP BY status
ORDER BY status;
