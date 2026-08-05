-- The department head sets the quantities they endorse.
--
-- Endorsement used to be a yes/no on the slip as filed. The head is the one
-- person who knows what their office actually needs this month, so they now
-- edit each line — **up or down**, unlike the checker downstream, who may only
-- cut. An increase is capped at what the office can genuinely still draw
-- (`balance - committed`), which is the same ceiling `createRequest` enforces;
-- that one cannot be a CHECK constraint because it depends on other requests.
--
-- Its own column, for the same reason `quantity_recommended` is: four
-- signatures, four numbers. Overwriting `quantity_requested` would make the
-- slip claim the supply officer asked for something they never typed, and the
-- filed figure is exactly what an audit of a raised quantity would want to see.
--
--   quantity_requested   — what the supply officer filed
--   quantity_endorsed    — what their department head stands behind
--   quantity_recommended — what the GSO checker says GSO can grant
--   quantity_approved    — what the GSO head grants

ALTER TABLE gso_inventory.request_items
  ADD COLUMN IF NOT EXISTS quantity_endorsed NUMERIC(14,2);

ALTER TABLE gso_inventory.request_items
  DROP CONSTRAINT IF EXISTS request_items_endorsed_non_negative;
ALTER TABLE gso_inventory.request_items
  ADD CONSTRAINT request_items_endorsed_non_negative CHECK (
    quantity_endorsed IS NULL OR quantity_endorsed >= 0
  );

-- The checker's ceiling moves from the filed quantity to the endorsed one.
-- Leaving it on `quantity_requested` would have refused every recommendation on
-- a line the head raised — the head's number is the office's ask now.
--
-- COALESCE, not a plain reference: requests endorsed before this migration have
-- no endorsed quantity, and the filed figure is what their head stood behind.
ALTER TABLE gso_inventory.request_items
  DROP CONSTRAINT IF EXISTS request_items_recommended_within_requested;
ALTER TABLE gso_inventory.request_items
  DROP CONSTRAINT IF EXISTS request_items_recommended_within_endorsed;
ALTER TABLE gso_inventory.request_items
  ADD CONSTRAINT request_items_recommended_within_endorsed CHECK (
    quantity_recommended IS NULL
    OR (
      quantity_recommended >= 0
      AND quantity_recommended <= COALESCE(quantity_endorsed, quantity_requested)
    )
  );

-- `request_items_approved_within_recommended` (migration 16) is unchanged: the
-- GSO head still cannot grant above what the checker recommended.

-- Requests already endorsed are deliberately not backfilled. NULL there means
-- "endorsed as filed, before the head could say otherwise", which is the truth
-- about those rows; every read COALESCEs to `quantity_requested`.
