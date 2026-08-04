-- Reset transactional data — requests, releases, and the ledger — while
-- leaving the fiscal-year baseline inventory exactly as migration 3 seeded it.
--
-- Safe to run because the baseline is never overwritten by anything downstream:
--
--   * `office_stocks.opening_quantity` is written only by the baseline seed.
--     `release_request` and `adjust_stock` both touch `quantity` alone, so the
--     column you restore *from* has not moved.
--   * The baseline ledger rows are the only ones with `movement_type = 'opening'`.
--     Every other row was written by a release or an adjustment.
--
-- So the reset is: delete the transactional rows, then copy `opening_quantity`
-- back into `quantity`.
--
-- Nothing here touches offices, categories, units, items, office_stocks rows
-- themselves, users, roles, or settings.
--
-- Run in the Supabase SQL editor.


-- ───────────────────────────────────────────────────────────────────────────
-- Before — what is about to be removed, and which balances are off baseline.
-- ───────────────────────────────────────────────────────────────────────────

SELECT 'requests'         AS table_name, count(*) AS rows FROM gso_inventory.requests
UNION ALL
SELECT 'request_items',   count(*) FROM gso_inventory.request_items
UNION ALL
SELECT 'request_logs',    count(*) FROM gso_inventory.request_logs
UNION ALL
SELECT 'request_releases', count(*) FROM gso_inventory.request_releases
UNION ALL
SELECT 'movements (non-opening)', count(*) FROM gso_inventory.stock_movements
  WHERE movement_type <> 'opening'
UNION ALL
SELECT 'movements (opening — KEPT)', count(*) FROM gso_inventory.stock_movements
  WHERE movement_type = 'opening'
UNION ALL
SELECT 'stock rows drawn down', count(*) FROM gso_inventory.office_stocks
  WHERE quantity IS DISTINCT FROM opening_quantity;


-- ───────────────────────────────────────────────────────────────────────────
-- OPTION A — full reset. Every request and every non-opening movement goes,
-- and all balances return to the baseline. This is what you want after a round
-- of sample requests.
--
-- Note this removes *all* requests, not just the sample ones. If some are real,
-- use Option B instead.
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- Ledger first. `stock_movements.request_id` is ON DELETE SET NULL, so deleting
-- the requests ahead of this would orphan the release rows rather than remove
-- them, and they would be left behind pointing at nothing.
DELETE FROM gso_inventory.stock_movements
WHERE movement_type <> 'opening';

-- `request_items`, `request_logs`, and `request_releases` (with its lines) are
-- all ON DELETE CASCADE from here.
DELETE FROM gso_inventory.requests;

-- Balances back to baseline.
UPDATE gso_inventory.office_stocks
SET quantity = opening_quantity,
    updated_at = now()
WHERE quantity IS DISTINCT FROM opening_quantity;

-- Restart RIS numbering at RIS-<year>-00001. `is_called => false` means the
-- next nextval() returns 1 rather than 2.
SELECT setval('gso_inventory.request_number_seq', 1, false);

COMMIT;


-- ───────────────────────────────────────────────────────────────────────────
-- OPTION B — scoped reset. Removes only the requests you name and rebuilds
-- each affected balance from the baseline plus whatever movements survive, so
-- replenishments, returns, and manual corrections you want to keep are replayed
-- rather than discarded.
--
-- Edit the `doomed` list, then run the block. Left commented out so a stray
-- execution of this file cannot fire both options.
-- ───────────────────────────────────────────────────────────────────────────

/*
BEGIN;

CREATE TEMP TABLE doomed ON COMMIT DROP AS
SELECT id FROM gso_inventory.requests
WHERE request_no IN ('RIS-2026-00001', 'RIS-2026-00002');   -- << the ones to undo
-- Other ways to select them, in place of the request_no list:
--   WHERE requested_at >= '2026-08-01'
--   WHERE office_id = (SELECT id FROM gso_inventory.offices WHERE code = 'GSO')

DELETE FROM gso_inventory.stock_movements
WHERE request_id IN (SELECT id FROM doomed);

DELETE FROM gso_inventory.requests
WHERE id IN (SELECT id FROM doomed);

-- Rebuild: baseline + the sum of every movement still standing. For rows whose
-- only remaining movement is the opening one this lands back on the baseline;
-- for rows with a surviving replenishment it keeps that replenishment.
--
-- `stock_movements` carries no fiscal_year, so this attributes every surviving
-- movement to the current baseline year — correct while one fiscal year is in
-- play, which is the case here. Revisit when FY2027 balances are seeded.
UPDATE gso_inventory.office_stocks s
SET quantity = s.opening_quantity + COALESCE((
      SELECT SUM(m.quantity)
      FROM gso_inventory.stock_movements m
      WHERE m.office_id = s.office_id
        AND m.item_id = s.item_id
        AND m.movement_type <> 'opening'
    ), 0),
    updated_at = now()
WHERE s.fiscal_year = (
  SELECT (value #>> '{}')::int FROM gso_inventory.system_settings WHERE key = 'fiscal_year'
);

COMMIT;
*/


-- ───────────────────────────────────────────────────────────────────────────
-- After — every count should be 0 and every balance should sit on baseline.
-- ───────────────────────────────────────────────────────────────────────────

SELECT 'requests left'          AS check, count(*) AS n FROM gso_inventory.requests
UNION ALL
SELECT 'non-opening movements', count(*) FROM gso_inventory.stock_movements
  WHERE movement_type <> 'opening'
UNION ALL
SELECT 'balances off baseline', count(*) FROM gso_inventory.office_stocks
  WHERE quantity IS DISTINCT FROM opening_quantity;

-- Baseline integrity: should still read 1,476 rows / 30,079 units for FY2026.
SELECT count(*) AS stock_rows,
       SUM(opening_quantity) AS baseline_units,
       SUM(quantity) AS current_units
FROM gso_inventory.office_stocks
WHERE fiscal_year = 2026;
