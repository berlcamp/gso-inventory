-- Retire over-the-counter walk-in issuance.
--
-- Every release now goes through the filed → endorsed → approved → released
-- pipeline. The one-step counter path is gone: it was the only flow that could
-- produce an issuance nobody in the requesting office ever signed for, which is
-- precisely the gap migration 14's receipt confirmation exists to close.
--
-- What goes and what stays:
--
--   * `create_walk_in_release` — dropped. Nothing can mint a walk-in again.
--   * `request.walk_in` — dropped, along with the role grants carrying it. A
--     permission nobody can exercise is worse than no permission at all: it
--     still shows up in the admin role editor as something meaningful to tick.
--   * `request_source` and `requests.source` — **kept**. Postgres cannot remove
--     a value from an enum, and rows already tagged 'walk_in' are real history
--     the request page still has to render honestly.

DROP FUNCTION IF EXISTS gso_inventory.create_walk_in_release(UUID, UUID, TEXT, TEXT, JSONB, TEXT);

DELETE FROM gso_inventory.role_permissions
WHERE permission_id IN (
  SELECT id FROM gso_inventory.permissions WHERE code = 'request.walk_in'
);

DELETE FROM gso_inventory.permissions WHERE code = 'request.walk_in';

-- The GSO custodian's description named walk-ins among its duties.
UPDATE gso_inventory.roles
SET description = 'Releases stock and maintains the catalog and balances'
WHERE code = 'gso_custodian';
