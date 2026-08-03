-- Department heads — one per office.
--
-- Filing is blocked for an office that has no department head, because the
-- slip would have nowhere to go. So every office that files must appear here
-- (or be given a head from Dashboard → Admin → Users) before its supply
-- officer can submit anything.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ FILL IN THE TABLE BELOW with each office's real Google email and name,   │
-- │ then apply this migration. Rows with a NULL email are skipped, so you    │
-- │ can apply it now and re-apply after filling more rows in — it is         │
-- │ idempotent.                                                             │
-- │                                                                         │
-- │ You can also do all of this without SQL from                            │
-- │ Dashboard → Admin → Users → Add User (pick the office + Department Head).│
-- └─────────────────────────────────────────────────────────────────────────┘

WITH heads (office_code, email, full_name) AS (
  VALUES
    -- office_code   email (Google account)          full name
    ('CCRO',      NULL::text, NULL::text),
    ('CADAC',     NULL,       NULL),
    ('SWEMO',     NULL,       NULL),
    ('CEO',       NULL,       NULL),
    ('NSD',       NULL,       NULL),
    ('GSO',       NULL,       NULL),
    ('CHO',       NULL,       NULL),
    ('CDRRMO',    NULL,       NULL),
    ('CASSO',     NULL,       NULL),
    ('CSWD',      NULL,       NULL),
    ('CAGRO',     NULL,       NULL),
    ('CVET',      NULL,       NULL),
    ('CBO',       NULL,       NULL),
    ('CTO-TOUR',  NULL,       NULL),
    ('EE-MALL',   NULL,       NULL),
    ('CTO',       NULL,       NULL),
    ('CHRMO',     NULL,       NULL),
    ('PESO',      NULL,       NULL),
    ('CACCO',     NULL,       NULL),
    ('SMLMCGH',   NULL,       NULL),
    ('OSCA',      NULL,       NULL),
    ('OCA',       NULL,       NULL),
    ('CLO',       NULL,       NULL),
    ('CMO',       NULL,       NULL),
    ('CPDO',      NULL,       NULL),
    ('COA',       NULL,       NULL),
    ('SP',        NULL,       NULL),
    ('BFP',       NULL,       NULL)
),
inserted AS (
  INSERT INTO gso_inventory.user_profiles (id, office_id, email, full_name, position)
  SELECT gen_random_uuid(), o.id, lower(h.email), h.full_name, 'Department Head'
  FROM heads h
  JOIN gso_inventory.offices o ON o.code = h.office_code
  WHERE h.email IS NOT NULL
  ON CONFLICT (email) DO NOTHING
  RETURNING id
)
SELECT count(*) AS profiles_created FROM inserted;

-- Grant the Department Head role to every profile positioned as one that does
-- not have it yet.
INSERT INTO gso_inventory.user_roles (user_id, role_id)
SELECT up.id, r.id
FROM gso_inventory.user_profiles up, gso_inventory.roles r
WHERE up.position = 'Department Head'
  AND r.code = 'department_head'
ON CONFLICT DO NOTHING;

-- Which offices can still not file — every row here blocks its supply officer.
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
