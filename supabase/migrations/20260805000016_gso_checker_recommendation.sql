-- GSO Checker — a checking stage between endorsement and approval.
--
-- The department head endorses; the GSO Checker then goes down the slip line by
-- line and writes what GSO can actually grant — **reducing only** — and
-- recommends it. Only then can the GSO Head approve. The head can no longer
-- approve straight off the review queue: a slip nobody has checked has no
-- recommended quantities to approve.
--
-- Modelled as its own status rather than a flag on `pending`, for the same
-- reason `awaiting_endorsement` was: every read that means "waiting on the
-- head" filters on `status`, so `pending` narrows to exactly "not checked yet"
-- and those queries stay correct without a second predicate anyone could
-- forget. A flag would have left `pending` meaning two things.
--
-- The recommendation is its own column rather than an early write into
-- `quantity_approved`: they are two different people's numbers, and a request
-- showing an approved quantity before anyone approved it is a lie the request
-- page would then have to keep telling.

-- Postgres allows ADD VALUE inside a transaction on 12+, but the new value
-- cannot be *used* until that transaction commits. Nothing below references
-- these values, so a single migration file is safe.
ALTER TYPE gso_inventory.request_status
  ADD VALUE IF NOT EXISTS 'recommended' BEFORE 'approved';

ALTER TYPE gso_inventory.request_action
  ADD VALUE IF NOT EXISTS 'recommended' AFTER 'endorsed';

-- Who checked the quantities, and when. Distinct from `endorsed_*` (the
-- department head's sign-off) and `reviewed_*` (the head's approval) — three
-- signatures, three pairs of columns.
ALTER TABLE gso_inventory.requests
  ADD COLUMN IF NOT EXISTS recommended_by UUID REFERENCES gso_inventory.user_profiles(id),
  ADD COLUMN IF NOT EXISTS recommended_at TIMESTAMPTZ;

ALTER TABLE gso_inventory.request_items
  ADD COLUMN IF NOT EXISTS quantity_recommended NUMERIC(14,2);

-- The two rules that make this stage worth having, put where nothing can go
-- around them: a checker may only cut what the office asked for, and the head
-- may only grant what was recommended. Both are same-row checks, so they cost
-- nothing and hold for any writer — the server action, a future RPC, or a hand
-- fix in the SQL editor.
--
-- NULL passes both: every request filed before this migration has no
-- recommendation, and those rows are history rather than violations.
ALTER TABLE gso_inventory.request_items
  DROP CONSTRAINT IF EXISTS request_items_recommended_within_requested;
ALTER TABLE gso_inventory.request_items
  ADD CONSTRAINT request_items_recommended_within_requested CHECK (
    quantity_recommended IS NULL
    OR (quantity_recommended >= 0 AND quantity_recommended <= quantity_requested)
  );

ALTER TABLE gso_inventory.request_items
  DROP CONSTRAINT IF EXISTS request_items_approved_within_recommended;
ALTER TABLE gso_inventory.request_items
  ADD CONSTRAINT request_items_approved_within_recommended CHECK (
    quantity_approved IS NULL
    OR quantity_recommended IS NULL
    OR quantity_approved <= quantity_recommended
  );

INSERT INTO gso_inventory.permissions (code, description) VALUES
  ('request.recommend',
   'Check quantities on endorsed requests and recommend them for approval')
ON CONFLICT (code) DO NOTHING;

INSERT INTO gso_inventory.roles (name, code, description) VALUES
  ('GSO Checker', 'gso_checker',
   'Checks endorsed requests, trims quantities to what GSO can grant, and recommends them for the GSO Head''s approval')
ON CONFLICT (code) DO NOTHING;

-- gso_checker — sees every office's requests (the queue is GSO-wide) and the
-- balances they are trimming against. Deliberately no `request.approve`:
-- separating the two is the entire point of the role.
INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code = 'gso_checker'
  AND p.code IN (
    'request.view', 'request.view_all', 'request.recommend', 'inventory.view'
  )
ON CONFLICT DO NOTHING;

-- `request.recommend` is granted to no other role on purpose. gso_custodian
-- already holds `request.approve`, and handing it both would put the check and
-- the approval back in one pair of hands. admin picks it up from the cross join
-- below and is the deliberate escape hatch — the same one that lets admin
-- endorse when an office's head is unavailable.

-- admin holds every permission — re-run migration 2's cross join so it picks
-- up 'request.recommend' as well.
INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

-- Requests already endorsed keep `pending` and are now the checker's queue.
-- They are deliberately *not* backfilled to `recommended`: doing so would
-- invent a recommendation nobody made, on quantities nobody looked at.
--
-- Which means nothing moves past `pending` until somebody holds this role.
-- Assign it in admin → users; the count below says how urgent that is.
SELECT
  (SELECT count(*)
     FROM gso_inventory.requests
    WHERE status = 'pending')                       AS requests_waiting_to_be_checked,
  (SELECT count(DISTINCT ur.user_id)
     FROM gso_inventory.user_roles ur
     JOIN gso_inventory.roles r ON r.id = ur.role_id
     JOIN gso_inventory.user_profiles u ON u.id = ur.user_id
    WHERE r.code IN ('gso_checker', 'admin')
      AND u.is_active)                              AS users_who_can_check;
