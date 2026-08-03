-- Department Head endorsement — a stage in front of GSO.
--
-- A supply officer files; their own department head endorses the slip (or
-- rejects it with a reason); only then does it land on GSO's desk. The head
-- does not touch quantities — trimming stays GSO's job at approval, so there
-- is exactly one place where approved quantities are decided.
--
-- Modelling this as its own status rather than a flag on `pending` is
-- deliberate: every GSO-side query already filters on `status`, so `pending`
-- narrows to mean exactly "waiting on GSO" and those queries become correct
-- without touching them. A boolean would have left `pending` meaning two
-- things and every GSO read having to remember a second predicate.

-- Postgres allows ADD VALUE inside a transaction on 12+, but the new value
-- cannot be *used* until that transaction commits. Nothing below references
-- these values, so a single migration file is safe.
ALTER TYPE gso_inventory.request_status
  ADD VALUE IF NOT EXISTS 'awaiting_endorsement' BEFORE 'pending';

ALTER TYPE gso_inventory.request_action
  ADD VALUE IF NOT EXISTS 'endorsed' AFTER 'submitted';

-- Who signed off inside the department, and when. Distinct from
-- `reviewed_by`/`reviewed_at`, which stay GSO's approval stamp.
ALTER TABLE gso_inventory.requests
  ADD COLUMN IF NOT EXISTS endorsed_by UUID REFERENCES gso_inventory.user_profiles(id),
  ADD COLUMN IF NOT EXISTS endorsed_at TIMESTAMPTZ;

-- Requests already filed keep `pending` and stay on GSO's desk — that is what
-- `pending` now means, so no backfill is needed.

INSERT INTO gso_inventory.permissions (code, description) VALUES
  ('request.endorse', 'Endorse or reject own office''s requests before GSO sees them')
ON CONFLICT (code) DO NOTHING;

INSERT INTO gso_inventory.roles (name, code, description) VALUES
  ('Department Head', 'department_head',
   'Endorses their own office''s supply requests before they reach GSO')
ON CONFLICT (code) DO NOTHING;

-- department_head — endorses for their own office; scoping to that office is
-- enforced in the server actions, as it is for supply officers. No
-- `request.create`: heads review what their supply officer files, they do not
-- file themselves.
INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code = 'department_head'
  AND p.code IN ('request.view', 'request.endorse', 'inventory.view')
ON CONFLICT DO NOTHING;

-- admin holds every permission — re-run migration 2's cross join so it picks
-- up 'request.endorse' as well.
INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;
