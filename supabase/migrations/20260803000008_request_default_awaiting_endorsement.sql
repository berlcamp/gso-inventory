-- A new request starts with its own department head, not with GSO.
--
-- Split out of migration 7 because Postgres refuses to *use* an enum value in
-- the same transaction that added it — 'awaiting_endorsement' only becomes
-- usable once that migration has committed.
--
-- Every insert path already sets `status` explicitly (`createRequest` writes
-- 'awaiting_endorsement', `create_walk_in_release` writes 'approved'), so this
-- default is never actually read today. It matters as a fail-closed backstop:
-- an insert that forgets the column should land in front of the department
-- head rather than skipping straight onto GSO's desk, which is precisely the
-- bypass this whole stage exists to prevent.

ALTER TABLE gso_inventory.requests
  ALTER COLUMN status SET DEFAULT 'awaiting_endorsement';
