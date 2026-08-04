-- Two-party sign-off on a release.
--
-- Recording a release used to be the custodian's word alone: `released_by` is
-- stamped by the RPC and `received_by_name` is free text the same custodian
-- types in. Nothing anywhere carried the requesting office's own confirmation
-- that the items and quantities that actually arrived are the ones on the slip.
-- This adds the counter-signature, and a place to disagree.
--
-- **Acknowledgement hangs off a release event, not off the request.** A request
-- can be handed over across several trips (`partially_released`), so a single
-- flag on `requests` would be silently wrong the moment a second batch went out
-- after the first was confirmed. Until now a batch had no identity at all --
-- `stock_movements` rows are per item with nothing tying one trip's rows
-- together, so "what went out on Tuesday" was not reconstructable. The header
-- row gives the trip an identity and the acknowledgement a subject.
--
-- **A dispute moves no stock.** `quantity_received` records what the office
-- says arrived and flags the release for GSO; correcting the balance stays
-- GSO's job through `adjust_stock`. That keeps the ledger with exactly one
-- author, and makes a shortfall show up as a visible correction rather than as
-- a department quietly editing inventory.

SET search_path TO gso_inventory, public;

-- 'waived' is for releases that predate this migration: they can never be
-- confirmed by anyone, and parking them in 'pending' would hand every office a
-- backlog of work it has no way to finish.
CREATE TYPE gso_inventory.release_ack_status AS ENUM (
  'pending', 'confirmed', 'disputed', 'waived'
);

-- ───────────────────────────────────────────────────────────────────────────
-- One row per `release_request` call — a single trip to the counter.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE gso_inventory.request_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES gso_inventory.requests(id) ON DELETE CASCADE,
  -- The custodian's attestation: who says these goods went out, and when.
  released_by UUID REFERENCES gso_inventory.user_profiles(id),
  released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who the custodian handed them to. Still their word — the acknowledgement
  -- below is what turns it into two people's word.
  received_by_name TEXT,
  remarks TEXT,
  ack_status gso_inventory.release_ack_status NOT NULL DEFAULT 'pending',
  acknowledged_by UUID REFERENCES gso_inventory.user_profiles(id),
  acknowledged_at TIMESTAMPTZ,
  ack_remarks TEXT,
  -- GSO's answer to a reported discrepancy. `ack_status` deliberately stays
  -- 'disputed' after this is set — the dispute happened, and overwriting it
  -- would erase the very thing the record exists for. These columns say it has
  -- been dealt with, which is what takes it off GSO's queue.
  dispute_resolved_by UUID REFERENCES gso_inventory.user_profiles(id),
  dispute_resolved_at TIMESTAMPTZ,
  dispute_resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_request_releases_request ON gso_inventory.request_releases(request_id);
CREATE INDEX idx_request_releases_ack ON gso_inventory.request_releases(ack_status);
CREATE INDEX idx_request_releases_released_at ON gso_inventory.request_releases(released_at DESC);

-- The two queues the bell reads: releases nobody has signed for, and disputes
-- GSO has not answered. Both are small slices of the table and stay small.
CREATE INDEX idx_request_releases_open
  ON gso_inventory.request_releases(ack_status, released_at)
  WHERE dispute_resolved_at IS NULL;

CREATE TABLE gso_inventory.request_release_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id UUID NOT NULL REFERENCES gso_inventory.request_releases(id) ON DELETE CASCADE,
  request_item_id UUID NOT NULL REFERENCES gso_inventory.request_items(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES gso_inventory.items(id),
  -- What the custodian says went out on this trip.
  quantity_issued NUMERIC(14,2) NOT NULL CHECK (quantity_issued > 0),
  -- What the office says arrived. NULL until someone acknowledges; equal to
  -- `quantity_issued` on a plain confirmation.
  quantity_received NUMERIC(14,2) CHECK (quantity_received >= 0),
  UNIQUE (release_id, request_item_id)
);

CREATE INDEX idx_release_items_release ON gso_inventory.request_release_items(release_id);

-- Ties each ledger row to the trip that produced it, so the receipt and the
-- balance change point at the same event instead of only sharing a request id.
ALTER TABLE gso_inventory.stock_movements
  ADD COLUMN IF NOT EXISTS release_id UUID
    REFERENCES gso_inventory.request_releases(id) ON DELETE SET NULL;

CREATE INDEX idx_movements_release ON gso_inventory.stock_movements(release_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill — every request that has already had stock issued gets one release
-- row so the detail page has something to render.
--
-- A request released across several trips collapses into a single synthetic
-- row: `requests` only ever kept the *latest* `released_by`/`released_at`, so
-- the individual trips were never recorded and cannot be recovered now.
-- Marked 'waived' rather than 'pending' — nobody signed for these, and
-- pretending otherwise would be the one thing this feature exists to prevent.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO gso_inventory.request_releases
  (request_id, released_by, released_at, received_by_name, ack_status, ack_remarks)
SELECT r.id,
       r.released_by,
       COALESCE(r.released_at, r.updated_at, now()),
       r.received_by_name,
       'waived',
       'Issued before receipt confirmation was introduced — no acknowledgement was ever captured.'
FROM gso_inventory.requests r
WHERE EXISTS (
  SELECT 1 FROM gso_inventory.request_items ri
  WHERE ri.request_id = r.id AND ri.quantity_released > 0
);

INSERT INTO gso_inventory.request_release_items
  (release_id, request_item_id, item_id, quantity_issued)
SELECT rel.id, ri.id, ri.item_id, ri.quantity_released
FROM gso_inventory.request_releases rel
JOIN gso_inventory.request_items ri ON ri.request_id = rel.request_id
WHERE rel.ack_status = 'waived'
  AND ri.quantity_released > 0;

-- Exactly one backfilled release per request, so this attribution is
-- unambiguous even though the trips behind it were not.
UPDATE gso_inventory.stock_movements m
SET release_id = rel.id
FROM gso_inventory.request_releases rel
WHERE rel.request_id = m.request_id
  AND m.movement_type = 'release'
  AND m.release_id IS NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- release_request — same contract as migration 6, plus the release header.
--
-- The header, its lines, the balance deduction, the ledger rows and the status
-- transition all commit together, exactly as before: a receipt that exists for
-- stock that never moved would be worse than no receipt.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gso_inventory.release_request(
  p_request_id UUID,
  p_actor_id UUID,
  p_lines JSONB,
  p_received_by TEXT DEFAULT NULL,
  p_remarks TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gso_inventory, public
AS $$
DECLARE
  v_office_id UUID;
  v_status gso_inventory.request_status;
  v_fiscal_year INTEGER;
  v_line JSONB;
  v_request_item_id UUID;
  v_qty NUMERIC(14,2);
  v_item_id UUID;
  v_approved NUMERIC(14,2);
  v_already NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_new_balance NUMERIC(14,2);
  v_item_name TEXT;
  v_outstanding NUMERIC(14,2);
  v_released_total NUMERIC(14,2);
  v_new_status gso_inventory.request_status;
  v_allow_over BOOLEAN;
  v_release_id UUID;
  v_lines_issued INTEGER := 0;
BEGIN
  -- Over-release is an explicit, audited policy choice: when on, a release may
  -- drive an office's balance negative rather than being refused. It does NOT
  -- waive the requirement that the office actually holds an allocation for the
  -- item -- a missing row still errors, since creating one here would invent an
  -- allocation that no fiscal-year baseline ever granted.
  SELECT COALESCE((value #>> '{}')::BOOLEAN, FALSE)
    INTO v_allow_over
  FROM gso_inventory.system_settings
  WHERE key = 'allow_over_release';

  v_allow_over := COALESCE(v_allow_over, FALSE);

  SELECT office_id, status, fiscal_year
    INTO v_office_id, v_status, v_fiscal_year
  FROM gso_inventory.requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_office_id IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_status NOT IN ('approved', 'partially_released') THEN
    RAISE EXCEPTION 'Only approved requests can be released (current status: %)', v_status;
  END IF;

  -- Naming the receiver is now mandatory: it is half of the two-party record,
  -- and an unnamed receiver leaves the acknowledgement with nobody to point at.
  IF p_received_by IS NULL OR btrim(p_received_by) = '' THEN
    RAISE EXCEPTION 'Record who is collecting the supplies before releasing them';
  END IF;

  INSERT INTO gso_inventory.request_releases
    (request_id, released_by, received_by_name, remarks)
  VALUES
    (p_request_id, p_actor_id, btrim(p_received_by), p_remarks)
  RETURNING id INTO v_release_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_request_item_id := (v_line->>'request_item_id')::UUID;
    v_qty := (v_line->>'quantity')::NUMERIC;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT ri.item_id,
           COALESCE(ri.quantity_approved, ri.quantity_requested),
           ri.quantity_released,
           i.name
      INTO v_item_id, v_approved, v_already, v_item_name
    FROM gso_inventory.request_items ri
    JOIN gso_inventory.items i ON i.id = ri.item_id
    WHERE ri.id = v_request_item_id AND ri.request_id = p_request_id
    FOR UPDATE OF ri;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Request line not found on this request';
    END IF;

    IF v_already + v_qty > v_approved THEN
      RAISE EXCEPTION 'Cannot release % of "%": approved quantity is % and % already released',
        v_qty, v_item_name, v_approved, v_already;
    END IF;

    -- Lock and check the requesting office's remaining balance for the
    -- request's fiscal year.
    SELECT quantity INTO v_balance
    FROM gso_inventory.office_stocks
    WHERE office_id = v_office_id
      AND item_id = v_item_id
      AND fiscal_year = v_fiscal_year
    FOR UPDATE;

    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'No % stock record for "%" under this office',
        v_fiscal_year, v_item_name;
    END IF;

    IF NOT v_allow_over AND v_balance < v_qty THEN
      RAISE EXCEPTION 'Insufficient balance for "%": remaining % , requested %',
        v_item_name, v_balance, v_qty;
    END IF;

    v_new_balance := v_balance - v_qty;

    UPDATE gso_inventory.office_stocks
    SET quantity = v_new_balance, updated_at = now()
    WHERE office_id = v_office_id
      AND item_id = v_item_id
      AND fiscal_year = v_fiscal_year;

    UPDATE gso_inventory.request_items
    SET quantity_released = v_already + v_qty
    WHERE id = v_request_item_id;

    -- What this trip handed over, as its own record. `request_items` only ever
    -- carries the running total, so it cannot answer "what went out today".
    INSERT INTO gso_inventory.request_release_items
      (release_id, request_item_id, item_id, quantity_issued)
    VALUES
      (v_release_id, v_request_item_id, v_item_id, v_qty);

    INSERT INTO gso_inventory.stock_movements
      (office_id, item_id, movement_type, quantity, balance_after, request_id,
       release_id, remarks, performed_by)
    VALUES
      (v_office_id, v_item_id, 'release', -v_qty, v_new_balance, p_request_id,
       v_release_id, p_remarks, p_actor_id);

    v_lines_issued := v_lines_issued + 1;
  END LOOP;

  -- Every line was zero or skipped: no goods moved, so there is nothing for
  -- anyone to sign for. Leaving the header would put an empty receipt in the
  -- requesting office's queue forever.
  IF v_lines_issued = 0 THEN
    DELETE FROM gso_inventory.request_releases WHERE id = v_release_id;
    v_release_id := NULL;
  END IF;

  -- Fully released when no line has an outstanding quantity left.
  SELECT COALESCE(SUM(COALESCE(quantity_approved, quantity_requested) - quantity_released), 0),
         COALESCE(SUM(quantity_released), 0)
    INTO v_outstanding, v_released_total
  FROM gso_inventory.request_items
  WHERE request_id = p_request_id;

  IF v_outstanding <= 0 THEN
    v_new_status := 'released';
  ELSIF v_released_total > 0 THEN
    v_new_status := 'partially_released';
  ELSE
    v_new_status := 'approved';
  END IF;

  UPDATE gso_inventory.requests
  SET status = v_new_status,
      released_by = CASE WHEN v_released_total > 0 THEN p_actor_id ELSE released_by END,
      released_at = CASE WHEN v_released_total > 0 THEN now() ELSE released_at END,
      received_by_name = COALESCE(btrim(p_received_by), received_by_name),
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO gso_inventory.request_logs (request_id, stage, action, actor_id, remarks)
  VALUES (p_request_id, v_new_status, 'released', p_actor_id, p_remarks);

  RETURN v_new_status::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION gso_inventory.release_request(UUID, UUID, JSONB, TEXT, TEXT)
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- acknowledge_release — the requesting office's counter-signature.
--
-- p_lines: [{ "release_item_id": uuid, "quantity_received": number }, ...]
-- Omit it entirely to confirm every line exactly as issued.
--
-- The two rules that make this accountability rather than a checkbox live
-- here, in the RPC, not in the UI: the acknowledger cannot be the person who
-- released, and they must belong to the office the goods went to.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gso_inventory.acknowledge_release(
  p_release_id UUID,
  p_actor_id UUID,
  p_lines JSONB DEFAULT NULL,
  p_remarks TEXT DEFAULT NULL,
  p_dispute BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gso_inventory, public
AS $$
DECLARE
  v_request_id UUID;
  v_office_id UUID;
  v_request_status gso_inventory.request_status;
  v_ack gso_inventory.release_ack_status;
  v_released_by UUID;
  v_actor_office UUID;
  v_line JSONB;
  v_release_item_id UUID;
  v_received NUMERIC(14,2);
  v_issued NUMERIC(14,2);
  v_mismatches INTEGER;
  v_unrecorded INTEGER;
  v_new_ack gso_inventory.release_ack_status;
BEGIN
  SELECT rel.request_id, rel.ack_status, rel.released_by, r.office_id, r.status
    INTO v_request_id, v_ack, v_released_by, v_office_id, v_request_status
  FROM gso_inventory.request_releases rel
  JOIN gso_inventory.requests r ON r.id = rel.request_id
  WHERE rel.id = p_release_id
  FOR UPDATE OF rel;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'Release not found';
  END IF;

  IF v_ack <> 'pending' THEN
    RAISE EXCEPTION 'This release has already been acknowledged (%). A correction is recorded as a stock adjustment, not by signing again.', v_ack;
  END IF;

  -- One person cannot both issue and receive. This is the whole point of the
  -- second signature, so it is checked where it cannot be bypassed.
  IF v_released_by IS NOT NULL AND v_released_by = p_actor_id THEN
    RAISE EXCEPTION 'The person who recorded this release cannot also confirm receipt of it';
  END IF;

  SELECT office_id INTO v_actor_office
  FROM gso_inventory.user_profiles
  WHERE id = p_actor_id AND is_active;

  IF v_actor_office IS NULL OR v_actor_office <> v_office_id THEN
    RAISE EXCEPTION 'Only the receiving office can confirm this release';
  END IF;

  IF p_dispute AND (p_remarks IS NULL OR btrim(p_remarks) = '') THEN
    RAISE EXCEPTION 'Describe the discrepancy before reporting it';
  END IF;

  -- No lines supplied means "everything arrived as issued".
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    UPDATE gso_inventory.request_release_items
    SET quantity_received = quantity_issued
    WHERE release_id = p_release_id;
  ELSE
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      v_release_item_id := (v_line->>'release_item_id')::UUID;
      v_received := (v_line->>'quantity_received')::NUMERIC;

      IF v_received IS NULL OR v_received < 0 THEN
        RAISE EXCEPTION 'Received quantity cannot be negative';
      END IF;

      SELECT rli.quantity_issued
        INTO v_issued
      FROM gso_inventory.request_release_items rli
      WHERE rli.id = v_release_item_id AND rli.release_id = p_release_id
      FOR UPDATE OF rli;

      IF v_issued IS NULL THEN
        RAISE EXCEPTION 'That line does not belong to this release';
      END IF;

      -- Deliberately *not* capped at `quantity_issued`. Over-delivery is a
      -- discrepancy too, and refusing to record it would leave the office
      -- choosing between signing for a number it knows is wrong and leaving
      -- the release unacknowledged. Nothing here touches stock either way --
      -- GSO reconciles it with an adjustment.

      UPDATE gso_inventory.request_release_items
      SET quantity_received = v_received
      WHERE id = v_release_item_id;
    END LOOP;

    -- A partially filled dispute would silently confirm the lines nobody
    -- touched, so require every line to have been answered.
    SELECT count(*) INTO v_unrecorded
    FROM gso_inventory.request_release_items
    WHERE release_id = p_release_id AND quantity_received IS NULL;

    IF v_unrecorded > 0 THEN
      RAISE EXCEPTION 'Record what arrived for every item on this release';
    END IF;
  END IF;

  SELECT count(*) INTO v_mismatches
  FROM gso_inventory.request_release_items
  WHERE release_id = p_release_id
    AND quantity_received IS DISTINCT FROM quantity_issued;

  IF p_dispute AND v_mismatches = 0 THEN
    RAISE EXCEPTION 'Every quantity matches what was issued — confirm the receipt instead of reporting a discrepancy';
  END IF;

  -- A mismatch is a dispute whether or not the button said so. Someone who
  -- edits a quantity and then hits Confirm has still reported a shortfall.
  v_new_ack := CASE WHEN p_dispute OR v_mismatches > 0 THEN 'disputed' ELSE 'confirmed' END;

  UPDATE gso_inventory.request_releases
  SET ack_status = v_new_ack,
      acknowledged_by = p_actor_id,
      acknowledged_at = now(),
      ack_remarks = NULLIF(btrim(COALESCE(p_remarks, '')), '')
  WHERE id = p_release_id;

  -- The cast is required, not decorative: both CASE branches are unknown-type
  -- literals, so the expression resolves to `text` and Postgres will not
  -- implicitly narrow that to the enum on the way into the column.
  INSERT INTO gso_inventory.request_logs (request_id, stage, action, actor_id, remarks)
  VALUES (
    v_request_id,
    v_request_status,
    (CASE WHEN v_new_ack = 'disputed' THEN 'disputed' ELSE 'received' END)
      ::gso_inventory.request_action,
    p_actor_id,
    NULLIF(btrim(COALESCE(p_remarks, '')), '')
  );

  -- The request did move, and the notification feed orders its queues by
  -- `updated_at`. Leaving it stale would keep a confirmed slip at the top of
  -- somebody's list.
  UPDATE gso_inventory.requests
  SET updated_at = now()
  WHERE id = v_request_id;

  RETURN v_new_ack::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION gso_inventory.acknowledge_release(UUID, UUID, JSONB, TEXT, BOOLEAN)
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Permission
--
-- Held by the requesting side. It says "may sign for a delivery"; which
-- delivery is decided by the office check inside the RPC, so granting it to
-- admin (who holds everything by invariant) does not let an admin sign for an
-- office they do not belong to.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO gso_inventory.permissions (code, description) VALUES
  ('request.acknowledge',
   'Confirm receipt of a release for own office, or report a discrepancy')
ON CONFLICT (code) DO NOTHING;

INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code IN ('supply_officer', 'department_head')
  AND p.code = 'request.acknowledge'
ON CONFLICT DO NOTHING;

-- admin holds every permission — re-run migration 2's cross join.
INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- RLS + grants — same model as migration 1: authorization lives in the server
-- actions and the RPCs; RLS gates the tables to authenticated users.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE gso_inventory.request_releases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.request_release_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['request_releases', 'request_release_items']
  LOOP
    EXECUTE format(
      'CREATE POLICY "auth read %1$s" ON gso_inventory.%1$I FOR SELECT TO authenticated USING (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY "auth insert %1$s" ON gso_inventory.%1$I FOR INSERT TO authenticated WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY "auth update %1$s" ON gso_inventory.%1$I FOR UPDATE TO authenticated USING (true)',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON gso_inventory.request_releases, gso_inventory.request_release_items
  TO authenticated;
GRANT ALL
  ON gso_inventory.request_releases, gso_inventory.request_release_items
  TO service_role;
