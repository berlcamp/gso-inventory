-- Supply officers — one per office.
--
-- Every department gets a supply officer who files supply requests to GSO on
-- behalf of that office. This migration pre-registers them by Google email;
-- each becomes a real account the first time they sign in.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ FILL IN THE TABLE BELOW with each office's real Google email and name,   │
-- │ then apply this migration. Rows with a NULL email are skipped, so you    │
-- │ can apply it now and re-apply after filling more rows in — it is         │
-- │ idempotent.                                                             │
-- │                                                                         │
-- │ You can also do all of this without SQL from                            │
-- │ Dashboard → Admin → Users → Add User (pick the office + Supply Officer). │
-- └─────────────────────────────────────────────────────────────────────────┘

WITH officers (office_code, email, full_name) AS (
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
  SELECT gen_random_uuid(), o.id, lower(f.email), f.full_name, 'Supply Officer'
  FROM officers f
  JOIN gso_inventory.offices o ON o.code = f.office_code
  WHERE f.email IS NOT NULL
  ON CONFLICT (email) DO NOTHING
  RETURNING id
)
SELECT count(*) AS profiles_created FROM inserted;

-- Grant the Supply Officer role to every profile positioned as one that does
-- not have it yet.
INSERT INTO gso_inventory.user_roles (user_id, role_id)
SELECT up.id, r.id
FROM gso_inventory.user_profiles up, gso_inventory.roles r
WHERE up.position = 'Supply Officer'
  AND r.code = 'supply_officer'
ON CONFLICT DO NOTHING;
