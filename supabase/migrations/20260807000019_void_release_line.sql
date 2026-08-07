-- Voiding a released line — GSO's correction when goods were recorded as
-- issued but never physically left the warehouse.
--
-- Until now the only answer to "we released it but it was not on the shelf"
-- was `adjust_stock`, and it was a bad one on three counts. The corrective row
-- carried no `request_id` and no `release_id`, so the only thing tying it to
-- the slip was whatever the custodian typed into `remarks`. Nothing appeared on
-- the request's own timeline, so the slip went on reading `released` forever
-- while the ledger said otherwise. And `office_stock_issued` counts only
-- `movement_type = 'release'`, so every issuance report kept reporting goods
-- that were never issued — the balance was right and every report was wrong.
--
-- A void fixes all three because it is the same event recorded properly: a
-- ledger row that names the release it reverses, a log entry on the request,
-- and a movement type the issuance figures know how to subtract.
--
-- **A void is not a deletion.** The original 'release' row stays exactly as
-- written, including on a release the office already signed for. What the
-- office signed is what it believed at the time; the void is the correction on
-- top, and erasing either half would leave the record unable to say a mistake
-- was ever made. `quantity_received` is untouched for the same reason.
--
-- **A void reopens the slip.** `request_items.quantity_released` comes back
-- down, so the request drops out of `released` and the outstanding quantity is
-- releasable again when the stock actually arrives. It is the same request,
-- still approved for the same quantity — nothing about the approval was wrong,
-- only the claim that it had been handed over.

SET search_path TO gso_inventory, public;

-- ───────────────────────────────────────────────────────────────────────────
-- How much of each issued line has been taken back.
--
-- Cumulative rather than a boolean: a trip that issued 50 and delivered 30 is
-- voided by 20, and the line is still a real release of 30. The CHECK is what
-- stops a second void from taking back more than ever went out.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE gso_inventory.request_release_items
  ADD COLUMN IF NOT EXISTS quantity_voided NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE gso_inventory.request_release_items
  DROP CONSTRAINT IF EXISTS request_release_items_voided_within_issued;

ALTER TABLE gso_inventory.request_release_items
  ADD CONSTRAINT request_release_items_voided_within_issued
  CHECK (quantity_voided >= 0 AND quantity_voided <= quantity_issued);

-- ───────────────────────────────────────────────────────────────────────────
-- Who may void.
--
-- Its own permission rather than a widening of `request.release`. Recording an
-- issuance and unrecording one are different powers: an LGU that later wants
-- voids restricted to the GSO head should be able to do that by deleting one
-- role_permissions row, not by editing an action. It is granted to the
-- custodian today because they are the desk that finds the error, at the
-- counter, while the person it affects is still standing there.
-- ───────────────────────────────────────────────────────────────────────────

INSERT INTO gso_inventory.permissions (code, description) VALUES
  ('request.void_release', 'Void a released line that never physically left the warehouse')
ON CONFLICT (code) DO NOTHING;

INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r
CROSS JOIN gso_inventory.permissions p
WHERE r.code IN ('admin', 'gso_head', 'gso_custodian')
  AND p.code = 'request.void_release'
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- Issuance, net of voids.
--
-- Releases are stored negative and voids positive, so `SUM(-quantity)` over
-- the pair is the netting — no CASE, and a row type that is added later
-- without being considered here simply does not enter the sum.
--
-- This is the single figure the inventory page and the stock-balance report
-- both read (`getAllOfficeStocks` and `getStockForExport`), which is why
-- correcting it here corrects both at once and they cannot drift apart.
--
-- The year still comes from `created_at`, so a release made in December and
-- voided in January nets against the following year. That is the same
-- calendar-year assumption the function was written with; fixing it properly
-- needs a real fiscal_year column on the ledger, not a cleverer predicate.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gso_inventory.office_stock_issued(
  p_fiscal_year INTEGER,
  p_office_id UUID DEFAULT NULL
)
RETURNS TABLE (office_id UUID, item_id UUID, issued NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = gso_inventory, public
AS $$
  SELECT m.office_id, m.item_id, SUM(-m.quantity)::NUMERIC
  FROM gso_inventory.stock_movements m
  WHERE m.movement_type IN ('release', 'void')
    AND EXTRACT(YEAR FROM m.created_at)::int = p_fiscal_year
    AND (p_office_id IS NULL OR m.office_id = p_office_id)
  GROUP BY m.office_id, m.item_id;
$$;

GRANT EXECUTE ON FUNCTION gso_inventory.office_stock_issued(INTEGER, UUID)
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- void_release_item — the whole correction, in one transaction.
--
-- Balance restored, line marked, request reopened, ledger row written, timeline
-- entry logged. Exactly like `release_request`, and for the same reason: a
-- balance that moved without a ledger row, or a ledger row for a balance that
-- did not move, is worse than either failure on its own.
--
-- A reason is mandatory. The whole point of a void over a bare adjustment is
-- that it says *why* the goods were not issued, and a blank one takes the
-- record back to where it started.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gso_inventory.void_release_item(
  p_release_item_id UUID,
  p_actor_id UUID,
  p_quantity NUMERIC,
  p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gso_inventory, public
AS $$
DECLARE
  v_release_id UUID;
  v_request_id UUID;
  v_request_item_id UUID;
  v_item_id UUID;
  v_item_name TEXT;
  v_issued NUMERIC(14,2);
  v_voided NUMERIC(14,2);
  v_voidable NUMERIC(14,2);
  v_qty NUMERIC(14,2);
  v_office_id UUID;
  v_fiscal_year INTEGER;
  v_status gso_inventory.request_status;
  v_balance NUMERIC(14,2);
  v_new_balance NUMERIC(14,2);
  v_already_released NUMERIC(14,2);
  v_outstanding NUMERIC(14,2);
  v_released_total NUMERIC(14,2);
  v_new_status gso_inventory.request_status;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Record why this line is being voided';
  END IF;

  SELECT rli.release_id, rli.request_item_id, rli.item_id,
         rli.quantity_issued, rli.quantity_voided, i.name
    INTO v_release_id, v_request_item_id, v_item_id,
         v_issued, v_voided, v_item_name
  FROM gso_inventory.request_release_items rli
  JOIN gso_inventory.items i ON i.id = rli.item_id
  WHERE rli.id = p_release_item_id
  FOR UPDATE OF rli;

  IF v_release_id IS NULL THEN
    RAISE EXCEPTION 'Release line not found';
  END IF;

  v_voidable := v_issued - v_voided;

  IF v_voidable <= 0 THEN
    RAISE EXCEPTION 'All % of "%" on this release has already been voided',
      v_issued, v_item_name;
  END IF;

  -- NULL means "the whole outstanding line", which is the common case: the
  -- item was not on the shelf at all.
  v_qty := COALESCE(p_quantity, v_voidable);

  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Void quantity must be greater than zero';
  END IF;

  IF v_qty > v_voidable THEN
    RAISE EXCEPTION 'Cannot void % of "%": % was issued on this release and % already voided',
      v_qty, v_item_name, v_issued, v_voided;
  END IF;

  -- The office comes off the request, never from caller input — the same rule
  -- `release_request` follows, and what makes it impossible to restore stock to
  -- an office other than the one it was drawn from.
  SELECT rel.request_id, r.office_id, r.fiscal_year, r.status
    INTO v_request_id, v_office_id, v_fiscal_year, v_status
  FROM gso_inventory.request_releases rel
  JOIN gso_inventory.requests r ON r.id = rel.request_id
  WHERE rel.id = v_release_id
  FOR UPDATE OF r;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'Release not found';
  END IF;

  SELECT quantity INTO v_balance
  FROM gso_inventory.office_stocks
  WHERE office_id = v_office_id
    AND item_id = v_item_id
    AND fiscal_year = v_fiscal_year
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'No % stock record for "%" under this office', v_fiscal_year, v_item_name;
  END IF;

  v_new_balance := v_balance + v_qty;

  UPDATE gso_inventory.office_stocks
  SET quantity = v_new_balance, updated_at = now()
  WHERE office_id = v_office_id
    AND item_id = v_item_id
    AND fiscal_year = v_fiscal_year;

  UPDATE gso_inventory.request_release_items
  SET quantity_voided = v_voided + v_qty
  WHERE id = p_release_item_id;

  -- Give the quantity back to the slip. GREATEST guards the arithmetic rather
  -- than trusting it: `quantity_released` is the running total across every
  -- trip, and driving it negative would make the status recompute below
  -- nonsense for every other line on the request.
  SELECT quantity_released INTO v_already_released
  FROM gso_inventory.request_items
  WHERE id = v_request_item_id
  FOR UPDATE;

  UPDATE gso_inventory.request_items
  SET quantity_released = GREATEST(0, v_already_released - v_qty)
  WHERE id = v_request_item_id;

  -- The audit trail proper: signed the opposite way to the release it
  -- reverses, and carrying both the request and the release so the correction
  -- can be traced back to the exact trip that produced it. `adjust_stock` sets
  -- neither, which is what made it the wrong tool for this.
  INSERT INTO gso_inventory.stock_movements
    (office_id, item_id, movement_type, quantity, balance_after, request_id,
     release_id, remarks, performed_by)
  VALUES
    (v_office_id, v_item_id, 'void', v_qty, v_new_balance, v_request_id,
     v_release_id, btrim(p_reason), p_actor_id);

  -- Same recompute as `release_request`, deliberately: the two must agree on
  -- what "fully released" means or a void could leave a slip in a state
  -- releasing could never have produced.
  SELECT COALESCE(SUM(COALESCE(quantity_approved, quantity_requested) - quantity_released), 0),
         COALESCE(SUM(quantity_released), 0)
    INTO v_outstanding, v_released_total
  FROM gso_inventory.request_items
  WHERE request_id = v_request_id;

  IF v_outstanding <= 0 THEN
    v_new_status := 'released';
  ELSIF v_released_total > 0 THEN
    v_new_status := 'partially_released';
  ELSE
    v_new_status := 'approved';
  END IF;

  UPDATE gso_inventory.requests
  SET status = v_new_status,
      updated_at = now()
  WHERE id = v_request_id;

  INSERT INTO gso_inventory.request_logs (request_id, stage, action, actor_id, remarks)
  VALUES (
    v_request_id,
    v_new_status,
    'voided',
    p_actor_id,
    format('%s × %s returned to stock — %s', v_qty, v_item_name, btrim(p_reason))
  );

  RETURN v_new_status::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION gso_inventory.void_release_item(UUID, UUID, NUMERIC, TEXT)
  TO authenticated, service_role;

-- Who can actually perform a void. Nothing here creates the situation the
-- feature exists for, but a GSO with nobody holding the permission would find
-- that out only at the counter.
SELECT r.code AS role, count(ur.user_id) AS holders
FROM gso_inventory.roles r
JOIN gso_inventory.role_permissions rp ON rp.role_id = r.id
JOIN gso_inventory.permissions p ON p.id = rp.permission_id
LEFT JOIN gso_inventory.user_roles ur ON ur.role_id = r.id
WHERE p.code = 'request.void_release'
GROUP BY r.code
ORDER BY r.code;
