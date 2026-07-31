-- Super Admin bootstrap.
--
-- user_profiles.id references auth.users(id), but the first admin has no auth
-- record yet. Same approach as the "Add User" screen: insert a placeholder UUID
-- with the real Google email. On first login the auth callback matches by email
-- and swaps in the real auth.users ID.
--
-- Step 1 — drop the FK so placeholder IDs are allowed.
ALTER TABLE gso_inventory.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

-- Step 2 — the super admin. CHANGE the email and name to yours before applying.
INSERT INTO gso_inventory.user_profiles (id, email, full_name, position, office_id)
SELECT
  gen_random_uuid(),
  'berlcamp@gmail.com',          -- << your Google email
  'System Administrator',        -- << your name
  'System Administrator',
  o.id
FROM gso_inventory.offices o
WHERE o.code = 'GSO'
ON CONFLICT (email) DO NOTHING;

-- Step 3 — grant the admin role.
INSERT INTO gso_inventory.user_roles (user_id, role_id)
SELECT up.id, r.id
FROM gso_inventory.user_profiles up, gso_inventory.roles r
WHERE up.email = 'berlcamp@gmail.com'   -- << same email as above
  AND r.code = 'admin'
ON CONFLICT DO NOTHING;

-- Step 4 — leave the FK off until every pre-registered profile has logged in
-- at least once. To re-enable later:
--
--   ALTER TABLE gso_inventory.user_profiles
--     ADD CONSTRAINT user_profiles_id_fkey
--     FOREIGN KEY (id) REFERENCES auth.users(id);
