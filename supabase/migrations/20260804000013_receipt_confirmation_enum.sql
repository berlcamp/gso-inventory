-- Enum values for receipt confirmation, split out from the migration that uses
-- them (14).
--
-- Postgres allows `ADD VALUE` inside a transaction on 12+, but the new value
-- cannot be *used* until that transaction commits. Migration 7 could add
-- `endorsed` and stop there because nothing in the same file referenced it;
-- migration 14 defines `acknowledge_release`, whose body writes both of these
-- literals. A plpgsql body is only parsed on first execution, so it would very
-- likely have been fine in one file — "very likely" is not a good enough reason
-- to put a production migration one planner detail away from failing.

ALTER TYPE gso_inventory.request_action
  ADD VALUE IF NOT EXISTS 'received' AFTER 'released';

ALTER TYPE gso_inventory.request_action
  ADD VALUE IF NOT EXISTS 'disputed' AFTER 'received';

-- GSO's answer to a reported discrepancy. A dispute nobody can close is not
-- accountability, it is a permanent red mark: the bell would light forever and
-- everyone would learn to ignore it.
ALTER TYPE gso_inventory.request_action
  ADD VALUE IF NOT EXISTS 'resolved' AFTER 'disputed';
