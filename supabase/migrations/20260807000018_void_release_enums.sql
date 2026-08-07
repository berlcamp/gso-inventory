-- Enum values for voiding a released line. Split from migration 19 for the
-- same reason 8 was split from 7 and 13 from 14: Postgres refuses to *use* an
-- enum value in the transaction that added it, and 19 writes both of these as
-- literals inside a function body.
--
-- 'void' is a ledger movement, not a deletion. A release that turns out never
-- to have happened cannot be erased — `stock_movements` is the audit trail, and
-- an audit trail you can delete from is not one. The correction is a new row
-- that points at the release it cancels, and the two net to zero.

SET search_path TO gso_inventory, public;

-- Positive quantity, mirroring the negative 'release' row it reverses. Issued
-- totals sum the pair, so a fully voided release reads as nothing issued
-- without either row being touched.
ALTER TYPE gso_inventory.movement_type ADD VALUE IF NOT EXISTS 'void';

-- Its counterpart on the request's own timeline, so the slip says what
-- happened rather than only the ledger.
ALTER TYPE gso_inventory.request_action ADD VALUE IF NOT EXISTS 'voided';
