-- Roles & permissions for the GSO Inventory System.
--
-- Two sides of the system:
--   • GSO custodians — approve requests, release stock, maintain the catalog.
--   • Department supply officers — file requests for their own office only.

INSERT INTO gso_inventory.permissions (code, description) VALUES
  ('request.create',    'File a supply request for an office'),
  ('request.view',      'View supply requests'),
  ('request.view_all',  'View requests from every office (not just own)'),
  ('request.approve',   'Approve or reject supply requests'),
  ('request.release',   'Record release/issuance of approved requests'),
  ('request.walk_in',   'Record over-the-counter walk-in releases'),
  ('inventory.view',    'View office stock balances'),
  ('inventory.adjust',  'Adjust balances — replenishment, returns, corrections'),
  ('item.manage',       'Create and edit items, categories, and units'),
  ('office.manage',     'Create and edit offices'),
  ('reports.view',      'View and export reports'),
  ('admin.manage',      'Manage users, roles, and system settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO gso_inventory.roles (name, code, description) VALUES
  ('Administrator',    'admin',          'Full access to every part of the system'),
  ('GSO Head',         'gso_head',       'Approves requests and reviews reports'),
  ('GSO Custodian',    'gso_custodian',  'Releases stock and maintains the catalog and balances'),
  ('Supply Officer',   'supply_officer', 'Files supply requests on behalf of their office')
ON CONFLICT (code) DO NOTHING;

-- admin — everything
INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

-- gso_head — sees everything, approves, reports
INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code = 'gso_head'
  AND p.code IN (
    'request.view', 'request.view_all', 'request.approve',
    'inventory.view', 'reports.view'
  )
ON CONFLICT DO NOTHING;

-- gso_custodian — the day-to-day GSO desk
INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code = 'gso_custodian'
  AND p.code IN (
    'request.view', 'request.view_all', 'request.approve', 'request.release',
    'request.walk_in', 'inventory.view', 'inventory.adjust',
    'item.manage', 'office.manage', 'reports.view'
  )
ON CONFLICT DO NOTHING;

-- supply_officer — own office only (scoping enforced in server actions)
INSERT INTO gso_inventory.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM gso_inventory.roles r, gso_inventory.permissions p
WHERE r.code = 'supply_officer'
  AND p.code IN ('request.create', 'request.view', 'inventory.view')
ON CONFLICT DO NOTHING;
