-- Make `allow_over_release` mean something.
--
-- The setting has existed in `system_settings` since the first migration but was
-- read by nothing: `release_request` always refused a release that exceeded the
-- office's remaining balance, so toggling it changed no behaviour at all.
--
-- This replaces the function with one that reads the flag. Everything else --
-- the over-release-against-approved-quantity guard, the ledger row, the status
-- recomputation -- is unchanged.

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

    INSERT INTO gso_inventory.stock_movements
      (office_id, item_id, movement_type, quantity, balance_after, request_id, remarks, performed_by)
    VALUES
      (v_office_id, v_item_id, 'release', -v_qty, v_new_balance, p_request_id, p_remarks, p_actor_id);
  END LOOP;

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
      received_by_name = COALESCE(p_received_by, received_by_name),
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO gso_inventory.request_logs (request_id, stage, action, actor_id, remarks)
  VALUES (p_request_id, v_new_status, 'released', p_actor_id, p_remarks);

  RETURN v_new_status::TEXT;
END;
$$;

-- CREATE OR REPLACE keeps the existing ACL, but re-granting keeps this file
-- correct if it is ever applied to a database where the function was dropped.
GRANT EXECUTE ON FUNCTION gso_inventory.release_request(UUID, UUID, JSONB, TEXT, TEXT)
  TO authenticated, service_role;
