-- Baseline allocations for items added after the 2026 spreadsheet load, and an
-- "Issued" figure that survives them.
--
-- The problem this fixes
-- ─────────────────────
-- "Issued" was never stored. Both the inventory table and the stock-balance
-- report derived it as `opening_quantity - quantity`. That identity only holds
-- while releases are the *only* movements a row ever sees, which is true for
-- rows the 2026 seed created and false for every other row:
--
--   * `adjust_stock` opened a brand-new allocation at opening_quantity = 0 and
--     then only ever moved `quantity`. Stocking a newly catalogued item with
--     10,000 units therefore rendered as "Issued -10,000".
--   * Even on a seeded row, any replenishment inflated `quantity` past
--     `opening_quantity` and understated (eventually negated) issuance.
--
-- Two changes, because there are two distinct problems underneath:
--
--   1. There was no way to grant a *baseline*. `adjust_stock` gains the
--      'opening' movement type — already in the enum since migration 1, never
--      reachable — which moves `opening_quantity` in step with `quantity`.
--      That is what "this office's fiscal-year allocation is N" means, and it
--      is what the seed did directly in SQL.
--   2. Issuance is the ledger's job. `office_stock_issued` sums the release
--      movements, which is how `reports.ts` has always computed consumption.
--      Derived arithmetic on two balance columns cannot answer it.
--
-- Keeping both matters: (1) alone still breaks the moment an office is
-- replenished, and (2) alone leaves new items reading as a zero baseline on
-- the Opening column and the stock-balance export.

-- ───────────────────────────────────────────────────────────────────────────
-- adjust_stock — replenishment, return, correction, and now opening balance.
--
-- Also changes where the fiscal year comes from. It read the wall clock
-- (`EXTRACT(YEAR FROM now())`) while requests, `release_request`, and the item
-- picker all read `system_settings.fiscal_year`. Both say 2026 today, so
-- nothing is broken yet — but the settings value is the one the rest of the
-- system keys `office_stocks` by, and an adjustment that opens a row in a
-- different year would be invisible to every other screen.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gso_inventory.adjust_stock(
  p_office_id UUID,
  p_item_id UUID,
  p_quantity NUMERIC,
  p_movement_type gso_inventory.movement_type,
  p_actor_id UUID,
  p_remarks TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gso_inventory, public
AS $$
DECLARE
  v_balance NUMERIC(14,2);
  v_opening NUMERIC(14,2);
  v_new_balance NUMERIC(14,2);
  v_new_opening NUMERIC(14,2);
  v_year INTEGER;
BEGIN
  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero';
  END IF;

  -- The year the rest of the system keys office_stocks by — not the calendar.
  SELECT (value #>> '{}')::int INTO v_year
  FROM gso_inventory.system_settings
  WHERE key = 'fiscal_year';

  IF v_year IS NULL THEN
    v_year := EXTRACT(YEAR FROM now())::int;
  END IF;

  SELECT quantity, opening_quantity INTO v_balance, v_opening
  FROM gso_inventory.office_stocks
  WHERE office_id = p_office_id
    AND item_id = p_item_id
    AND fiscal_year = v_year
  FOR UPDATE;

  IF v_balance IS NULL THEN
    -- First time this office carries the item — open a row at zero.
    INSERT INTO gso_inventory.office_stocks (office_id, item_id, quantity, opening_quantity, fiscal_year)
    VALUES (p_office_id, p_item_id, 0, 0, v_year)
    ON CONFLICT (office_id, item_id, fiscal_year) DO NOTHING;
    v_balance := 0;
    v_opening := 0;
  END IF;

  v_new_balance := v_balance + p_quantity;

  -- An opening movement establishes (or corrects) the fiscal-year baseline, so
  -- it moves both columns together and leaves issuance untouched. Every other
  -- type moves only the live balance: a replenishment is stock arriving on top
  -- of the baseline, not an enlargement of it.
  IF p_movement_type = 'opening' THEN
    v_new_opening := v_opening + p_quantity;
  ELSE
    v_new_opening := v_opening;
  END IF;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Adjustment would drive the balance negative (current %, change %)',
      v_balance, p_quantity;
  END IF;

  IF v_new_opening < 0 THEN
    RAISE EXCEPTION 'Adjustment would drive the opening balance negative (current %, change %)',
      v_opening, p_quantity;
  END IF;

  UPDATE gso_inventory.office_stocks
  SET quantity = v_new_balance,
      opening_quantity = v_new_opening,
      updated_at = now()
  WHERE office_id = p_office_id
    AND item_id = p_item_id
    AND fiscal_year = v_year;

  INSERT INTO gso_inventory.stock_movements
    (office_id, item_id, movement_type, quantity, balance_after, remarks, performed_by)
  VALUES
    (p_office_id, p_item_id, p_movement_type, p_quantity, v_new_balance, p_remarks, p_actor_id);

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION gso_inventory.adjust_stock(UUID, UUID, NUMERIC, gso_inventory.movement_type, UUID, TEXT)
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- office_stock_issued — how much has actually gone out, per office and item.
--
-- Releases are stored signed (negative), so the sum is negated back to a
-- positive quantity. Returns are deliberately *not* netted off: `reports.ts`
-- keeps releases and returns in separate columns on the grounds that how to
-- treat a return is the reader's judgement, and this figure has to agree with
-- those reports.
--
-- `stock_movements` carries no fiscal_year, so the year is taken from
-- `created_at`. That matches how `office_stocks.fiscal_year` is seeded (from
-- the calendar year) and is exact as long as a fiscal year is a calendar year.
-- If the LGU ever adopts an offset fiscal year, this needs a real fiscal_year
-- column on the ledger rather than a smarter date predicate.
--
-- SECURITY DEFINER like every other RPC here, so it takes an explicit office
-- filter: callers without `request.view_all` pass their own office and get
-- nothing else back.
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
  SELECT m.office_id, m.item_id, SUM(ABS(m.quantity))::NUMERIC
  FROM gso_inventory.stock_movements m
  WHERE m.movement_type = 'release'
    AND EXTRACT(YEAR FROM m.created_at)::int = p_fiscal_year
    AND (p_office_id IS NULL OR m.office_id = p_office_id)
  GROUP BY m.office_id, m.item_id;
$$;

GRANT EXECUTE ON FUNCTION gso_inventory.office_stock_issued(INTEGER, UUID)
  TO authenticated, service_role;

-- Summing the ledger per (office, item) every time the inventory page loads
-- wants more than the per-column indexes migration 1 created.
CREATE INDEX IF NOT EXISTS idx_movements_office_item_type
  ON gso_inventory.stock_movements(office_id, item_id, movement_type);

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill: rows that `adjust_stock` opened before this migration carry
-- opening_quantity = 0 while holding stock that was never issued to them,
-- which is what produced the negative "Issued". Restate their baseline as
-- everything that has ever arrived, less nothing — i.e. current balance plus
-- whatever has already gone out.
--
-- Scoped to rows the seed did not create: a seeded row already has its true
-- spreadsheet baseline, and `opening_quantity = 0` there means the office
-- genuinely started the year with none.
-- ───────────────────────────────────────────────────────────────────────────

UPDATE gso_inventory.office_stocks s
SET opening_quantity = s.quantity + COALESCE((
      SELECT SUM(ABS(m.quantity))
      FROM gso_inventory.stock_movements m
      WHERE m.office_id = s.office_id
        AND m.item_id = s.item_id
        AND m.movement_type = 'release'
    ), 0),
    updated_at = now()
WHERE s.opening_quantity = 0
  AND s.quantity > 0
  -- Never touch a row the seed wrote. There, opening_quantity = 0 is a fact
  -- from the spreadsheet ("this office was allocated none"), and stock on hand
  -- is a mid-year arrival on top of that baseline — exactly the case where
  -- restating the baseline would be wrong. The seed left an 'opening' ledger
  -- row on every one of its rows, which is what distinguishes them.
  AND NOT EXISTS (
    SELECT 1 FROM gso_inventory.stock_movements m2
    WHERE m2.office_id = s.office_id
      AND m2.item_id = s.item_id
      AND m2.movement_type = 'opening'
  );

-- Allocations that still carry no baseline. Re-running the migration is a
-- no-op (the WHERE clause no longer matches anything it already fixed), so
-- this is safe to apply repeatedly. Rows listed with remaining 0 are simply
-- allocations nobody has stocked yet — give them one from
-- Dashboard → Inventory → Adjust Stock → "Opening balance".
SELECT o.code AS office, i.name AS item,
       s.opening_quantity AS opening, s.quantity AS remaining
FROM gso_inventory.office_stocks s
JOIN gso_inventory.offices o ON o.id = s.office_id
JOIN gso_inventory.items i ON i.id = s.item_id
WHERE s.opening_quantity = 0
ORDER BY o.code, i.name;
