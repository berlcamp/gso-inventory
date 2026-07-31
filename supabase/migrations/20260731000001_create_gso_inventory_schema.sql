-- GSO Inventory System — LGU Ozamiz City
-- Custom schema: gso_inventory
--
-- Model: the General Services Office (GSO) controls office supplies. Every other
-- department carries a *remaining balance* per item for the fiscal year. When a
-- department requests supplies (through this system or as a walk-in), GSO records
-- the release and the requesting office's remaining balance goes down.

CREATE SCHEMA IF NOT EXISTS gso_inventory;

-- ───────────────────────────────────────────────────────────────────────────
-- Enums
-- ───────────────────────────────────────────────────────────────────────────

-- pending    → submitted, awaiting GSO review
-- approved   → GSO approved (quantities may have been adjusted), awaiting release
-- partially_released → some lines released, balance still outstanding
-- released   → fully released
-- rejected   → GSO declined
-- cancelled  → withdrawn by the requesting office before approval
CREATE TYPE gso_inventory.request_status AS ENUM (
  'pending', 'approved', 'partially_released', 'released', 'rejected', 'cancelled'
);

CREATE TYPE gso_inventory.request_source AS ENUM ('system', 'walk_in');

-- opening       → baseline balance loaded from the 2026 inventory sheet
-- release       → GSO issued stock to an office (decreases balance)
-- replenishment → new procurement / additional allocation (increases balance)
-- return        → office returned unused stock (increases balance)
-- adjustment    → manual correction by GSO (either direction)
CREATE TYPE gso_inventory.movement_type AS ENUM (
  'opening', 'release', 'replenishment', 'return', 'adjustment'
);

CREATE TYPE gso_inventory.request_action AS ENUM (
  'submitted', 'approved', 'rejected', 'released', 'cancelled', 'updated'
);

-- ───────────────────────────────────────────────────────────────────────────
-- Offices & users
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE gso_inventory.offices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  head_name TEXT,
  contact_number TEXT,
  -- The GSO itself is an office too, but it is the custodian rather than a requester.
  is_gso BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gso_inventory.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  office_id UUID REFERENCES gso_inventory.offices(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  position TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gso_inventory.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE gso_inventory.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE gso_inventory.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES gso_inventory.user_profiles(id) ON DELETE CASCADE,
  role_id UUID REFERENCES gso_inventory.roles(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role_id)
);

CREATE TABLE gso_inventory.role_permissions (
  role_id UUID REFERENCES gso_inventory.roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES gso_inventory.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ───────────────────────────────────────────────────────────────────────────
-- Catalog
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE gso_inventory.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gso_inventory.units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gso_inventory.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES gso_inventory.categories(id),
  unit_id UUID NOT NULL REFERENCES gso_inventory.units(id),
  name TEXT NOT NULL,
  description TEXT,
  -- Balance at or below this level flags the office stock row as low.
  reorder_level NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name, unit_id)
);

CREATE INDEX idx_items_category ON gso_inventory.items(category_id);
CREATE INDEX idx_items_name ON gso_inventory.items(lower(name));

-- ───────────────────────────────────────────────────────────────────────────
-- Stock — one row per (office, item). `quantity` is the office's remaining
-- balance for the fiscal year; `opening_quantity` is the baseline it started at.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE gso_inventory.office_stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id UUID NOT NULL REFERENCES gso_inventory.offices(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES gso_inventory.items(id) ON DELETE CASCADE,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  opening_quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  fiscal_year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (office_id, item_id, fiscal_year)
);

CREATE INDEX idx_office_stocks_office ON gso_inventory.office_stocks(office_id);
CREATE INDEX idx_office_stocks_item ON gso_inventory.office_stocks(item_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Requests
-- ───────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE gso_inventory.request_number_seq START 1;

CREATE OR REPLACE FUNCTION gso_inventory.format_request_number(n BIGINT)
RETURNS TEXT
LANGUAGE sql
-- VOLATILE, not IMMUTABLE: the result depends on now().
VOLATILE
AS $$
  SELECT 'RIS-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 5, '0')
$$;

CREATE TABLE gso_inventory.requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no TEXT NOT NULL UNIQUE
    DEFAULT gso_inventory.format_request_number(nextval('gso_inventory.request_number_seq')),
  office_id UUID NOT NULL REFERENCES gso_inventory.offices(id),
  requested_by UUID REFERENCES gso_inventory.user_profiles(id),
  -- Free text for walk-ins where the person collecting has no system account.
  requester_name TEXT,
  source gso_inventory.request_source NOT NULL DEFAULT 'system',
  status gso_inventory.request_status NOT NULL DEFAULT 'pending',
  purpose TEXT,
  remarks TEXT,
  fiscal_year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  requested_at TIMESTAMPTZ DEFAULT now(),
  reviewed_by UUID REFERENCES gso_inventory.user_profiles(id),
  reviewed_at TIMESTAMPTZ,
  released_by UUID REFERENCES gso_inventory.user_profiles(id),
  released_at TIMESTAMPTZ,
  received_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_requests_office ON gso_inventory.requests(office_id);
CREATE INDEX idx_requests_status ON gso_inventory.requests(status);
CREATE INDEX idx_requests_requested_at ON gso_inventory.requests(requested_at DESC);

CREATE TABLE gso_inventory.request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES gso_inventory.requests(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES gso_inventory.items(id),
  quantity_requested NUMERIC(14,2) NOT NULL CHECK (quantity_requested > 0),
  quantity_approved NUMERIC(14,2),
  quantity_released NUMERIC(14,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (request_id, item_id)
);

CREATE INDEX idx_request_items_request ON gso_inventory.request_items(request_id);
CREATE INDEX idx_request_items_item ON gso_inventory.request_items(item_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Ledger — every balance change writes one row here. This is the audit trail
-- and the source for all issuance reporting.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE gso_inventory.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id UUID NOT NULL REFERENCES gso_inventory.offices(id),
  item_id UUID NOT NULL REFERENCES gso_inventory.items(id),
  movement_type gso_inventory.movement_type NOT NULL,
  -- Signed: negative for releases, positive for replenishments/returns.
  quantity NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  request_id UUID REFERENCES gso_inventory.requests(id) ON DELETE SET NULL,
  remarks TEXT,
  performed_by UUID REFERENCES gso_inventory.user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_movements_office ON gso_inventory.stock_movements(office_id);
CREATE INDEX idx_movements_item ON gso_inventory.stock_movements(item_id);
CREATE INDEX idx_movements_created ON gso_inventory.stock_movements(created_at DESC);
CREATE INDEX idx_movements_request ON gso_inventory.stock_movements(request_id);

-- Audit log for request status transitions.
CREATE TABLE gso_inventory.request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES gso_inventory.requests(id) ON DELETE CASCADE,
  stage gso_inventory.request_status NOT NULL,
  action gso_inventory.request_action NOT NULL,
  actor_id UUID REFERENCES gso_inventory.user_profiles(id),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_request_logs_request ON gso_inventory.request_logs(request_id);
CREATE INDEX idx_request_logs_created ON gso_inventory.request_logs(created_at DESC);

CREATE TABLE gso_inventory.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES gso_inventory.user_profiles(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO gso_inventory.system_settings (key, value) VALUES
  ('fiscal_year', to_jsonb(EXTRACT(YEAR FROM now())::int)),
  ('low_stock_threshold', '5'),
  ('allow_over_release', 'false');

-- ───────────────────────────────────────────────────────────────────────────
-- Release RPC — the only path that moves stock for a request.
--
-- p_lines: [{ "request_item_id": uuid, "quantity": number }, ...]
-- Atomically deducts each line from the requesting office's balance, writes a
-- ledger row per line, and recomputes the request status.
-- ───────────────────────────────────────────────────────────────────────────

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
BEGIN
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

    IF v_balance < v_qty THEN
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

GRANT EXECUTE ON FUNCTION gso_inventory.release_request(UUID, UUID, JSONB, TEXT, TEXT)
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Manual stock adjustment (replenishment / return / correction).
-- p_quantity is signed: positive adds, negative deducts.
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
  v_new_balance NUMERIC(14,2);
  v_year INTEGER := EXTRACT(YEAR FROM now())::int;
BEGIN
  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero';
  END IF;

  SELECT quantity INTO v_balance
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
  END IF;

  v_new_balance := v_balance + p_quantity;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'Adjustment would drive the balance negative (current %, change %)',
      v_balance, p_quantity;
  END IF;

  UPDATE gso_inventory.office_stocks
  SET quantity = v_new_balance, updated_at = now()
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
-- Walk-in release — GSO records an over-the-counter issuance in one step.
-- Creates an already-approved request, then releases it.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gso_inventory.create_walk_in_release(
  p_office_id UUID,
  p_actor_id UUID,
  p_requester_name TEXT,
  p_purpose TEXT,
  p_lines JSONB,   -- [{ "item_id": uuid, "quantity": number }, ...]
  p_remarks TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gso_inventory, public
AS $$
DECLARE
  v_request_id UUID;
  v_line JSONB;
  v_release_lines JSONB := '[]'::jsonb;
  v_request_item_id UUID;
BEGIN
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  INSERT INTO gso_inventory.requests
    (office_id, requested_by, requester_name, source, status, purpose, remarks,
     reviewed_by, reviewed_at)
  VALUES
    (p_office_id, p_actor_id, p_requester_name, 'walk_in', 'approved', p_purpose, p_remarks,
     p_actor_id, now())
  RETURNING id INTO v_request_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO gso_inventory.request_items
      (request_id, item_id, quantity_requested, quantity_approved)
    VALUES
      (v_request_id,
       (v_line->>'item_id')::UUID,
       (v_line->>'quantity')::NUMERIC,
       (v_line->>'quantity')::NUMERIC)
    RETURNING id INTO v_request_item_id;

    v_release_lines := v_release_lines || jsonb_build_array(
      jsonb_build_object('request_item_id', v_request_item_id, 'quantity', (v_line->>'quantity')::NUMERIC)
    );
  END LOOP;

  INSERT INTO gso_inventory.request_logs (request_id, stage, action, actor_id, remarks)
  VALUES (v_request_id, 'approved', 'submitted', p_actor_id, 'Walk-in request recorded by GSO');

  PERFORM gso_inventory.release_request(
    v_request_id, p_actor_id, v_release_lines, p_requester_name, p_remarks
  );

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION gso_inventory.create_walk_in_release(UUID, UUID, TEXT, TEXT, JSONB, TEXT)
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- RLS — mirrors the mtop model: authorization is enforced in server actions
-- via the permission tables; RLS gates access to authenticated users only.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE gso_inventory.offices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.user_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.user_roles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.units            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.office_stocks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.request_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.stock_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.request_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gso_inventory.system_settings  ENABLE ROW LEVEL SECURITY;

-- Read-for-all-authenticated on every table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'offices', 'user_profiles', 'roles', 'permissions', 'user_roles',
    'role_permissions', 'categories', 'units', 'items', 'office_stocks',
    'requests', 'request_items', 'stock_movements', 'request_logs', 'system_settings'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY "auth read %1$s" ON gso_inventory.%1$I FOR SELECT TO authenticated USING (true)',
      t
    );
  END LOOP;
END $$;

-- Write access for authenticated users on the operational tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'offices', 'categories', 'units', 'items', 'office_stocks',
    'requests', 'request_items', 'stock_movements', 'request_logs', 'system_settings'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY "auth insert %1$s" ON gso_inventory.%1$I FOR INSERT TO authenticated WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY "auth update %1$s" ON gso_inventory.%1$I FOR UPDATE TO authenticated USING (true)',
      t
    );
  END LOOP;
END $$;

CREATE POLICY "auth delete request_items"
  ON gso_inventory.request_items FOR DELETE TO authenticated USING (true);

CREATE POLICY "users update own profile"
  ON gso_inventory.user_profiles FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE POLICY "users insert own profile"
  ON gso_inventory.user_profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- ───────────────────────────────────────────────────────────────────────────
-- Grants — RLS alone is not enough; the roles need schema/table privileges.
-- ───────────────────────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA gso_inventory TO authenticated, anon, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gso_inventory TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA gso_inventory TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA gso_inventory TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA gso_inventory
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA gso_inventory
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA gso_inventory
  GRANT USAGE ON SEQUENCES TO authenticated, service_role;
