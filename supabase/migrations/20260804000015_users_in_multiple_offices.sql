-- One person, several offices, same roles.
--
-- `user_profiles.office_id` is a single FK, so a supply officer who covers two
-- departments needed two accounts — two Google logins, two audit identities,
-- and a slip filed under whichever one they happened to be signed in as. This
-- makes the office assignment a set.
--
-- **Roles stay global to the user.** The ask was the same role across several
-- offices, and that is what the existing model already expresses: `user_roles`
-- says what someone may do, `user_offices` says where. Per-office roles would
-- be a different and much larger change -- every permission check would have to
-- carry an office argument -- and nothing here needs it.
--
-- `office_id` is kept as the **primary office**: it is what the topbar shows,
-- what a new request defaults to, and what the auth callback copies. The set is
-- what authorization reads.
--
-- Authorization is the **union** of `user_offices` and the primary `office_id`.
-- The union cannot over-grant -- the primary is itself a real assignment -- and
-- it means a row that somehow misses the backfill degrades to today's behaviour
-- instead of locking someone out of their own office.

SET search_path TO gso_inventory, public;

CREATE TABLE gso_inventory.user_offices (
  user_id UUID NOT NULL REFERENCES gso_inventory.user_profiles(id) ON DELETE CASCADE,
  office_id UUID NOT NULL REFERENCES gso_inventory.offices(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, office_id)
);

-- The reverse lookup: "who acts for this office", used by the offices page and
-- by the department-head check that gates filing.
CREATE INDEX idx_user_offices_office ON gso_inventory.user_offices(office_id);

-- Everyone keeps exactly what they have today.
INSERT INTO gso_inventory.user_offices (user_id, office_id)
SELECT id, office_id
FROM gso_inventory.user_profiles
WHERE office_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- acknowledge_release — the office check widens to the set.
--
-- Everything else about the function is unchanged; only the membership test
-- moves from "the actor's one office" to "any office the actor acts for".
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gso_inventory.acknowledge_release(
  p_release_id UUID,
  p_actor_id UUID,
  p_lines JSONB DEFAULT NULL,
  p_remarks TEXT DEFAULT NULL,
  p_dispute BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = gso_inventory, public
AS $$
DECLARE
  v_request_id UUID;
  v_office_id UUID;
  v_request_status gso_inventory.request_status;
  v_ack gso_inventory.release_ack_status;
  v_released_by UUID;
  v_in_office BOOLEAN;
  v_line JSONB;
  v_release_item_id UUID;
  v_received NUMERIC(14,2);
  v_issued NUMERIC(14,2);
  v_mismatches INTEGER;
  v_unrecorded INTEGER;
  v_new_ack gso_inventory.release_ack_status;
BEGIN
  SELECT rel.request_id, rel.ack_status, rel.released_by, r.office_id, r.status
    INTO v_request_id, v_ack, v_released_by, v_office_id, v_request_status
  FROM gso_inventory.request_releases rel
  JOIN gso_inventory.requests r ON r.id = rel.request_id
  WHERE rel.id = p_release_id
  FOR UPDATE OF rel;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'Release not found';
  END IF;

  IF v_ack <> 'pending' THEN
    RAISE EXCEPTION 'This release has already been acknowledged (%). A correction is recorded as a stock adjustment, not by signing again.', v_ack;
  END IF;

  -- One person cannot both issue and receive. This is the whole point of the
  -- second signature, so it is checked where it cannot be bypassed.
  IF v_released_by IS NOT NULL AND v_released_by = p_actor_id THEN
    RAISE EXCEPTION 'The person who recorded this release cannot also confirm receipt of it';
  END IF;

  -- Any office the actor acts for, primary or otherwise. The profile's own
  -- `office_id` is included so an assignment that predates `user_offices`
  -- still counts -- it is a real assignment either way, so the union can only
  -- match offices this person is genuinely in.
  SELECT EXISTS (
    SELECT 1
    FROM gso_inventory.user_profiles p
    WHERE p.id = p_actor_id
      AND p.is_active
      AND (
        p.office_id = v_office_id
        OR EXISTS (
          SELECT 1 FROM gso_inventory.user_offices uo
          WHERE uo.user_id = p.id AND uo.office_id = v_office_id
        )
      )
  ) INTO v_in_office;

  IF NOT v_in_office THEN
    RAISE EXCEPTION 'Only the receiving office can confirm this release';
  END IF;

  IF p_dispute AND (p_remarks IS NULL OR btrim(p_remarks) = '') THEN
    RAISE EXCEPTION 'Describe the discrepancy before reporting it';
  END IF;

  -- No lines supplied means "everything arrived as issued".
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    UPDATE gso_inventory.request_release_items
    SET quantity_received = quantity_issued
    WHERE release_id = p_release_id;
  ELSE
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      v_release_item_id := (v_line->>'release_item_id')::UUID;
      v_received := (v_line->>'quantity_received')::NUMERIC;

      IF v_received IS NULL OR v_received < 0 THEN
        RAISE EXCEPTION 'Received quantity cannot be negative';
      END IF;

      SELECT rli.quantity_issued
        INTO v_issued
      FROM gso_inventory.request_release_items rli
      WHERE rli.id = v_release_item_id AND rli.release_id = p_release_id
      FOR UPDATE OF rli;

      IF v_issued IS NULL THEN
        RAISE EXCEPTION 'That line does not belong to this release';
      END IF;

      -- Deliberately *not* capped at `quantity_issued`. Over-delivery is a
      -- discrepancy too, and refusing to record it would leave the office
      -- choosing between signing for a number it knows is wrong and leaving
      -- the release unacknowledged. Nothing here touches stock either way --
      -- GSO reconciles it with an adjustment.

      UPDATE gso_inventory.request_release_items
      SET quantity_received = v_received
      WHERE id = v_release_item_id;
    END LOOP;

    -- A partially filled dispute would silently confirm the lines nobody
    -- touched, so require every line to have been answered.
    SELECT count(*) INTO v_unrecorded
    FROM gso_inventory.request_release_items
    WHERE release_id = p_release_id AND quantity_received IS NULL;

    IF v_unrecorded > 0 THEN
      RAISE EXCEPTION 'Record what arrived for every item on this release';
    END IF;
  END IF;

  SELECT count(*) INTO v_mismatches
  FROM gso_inventory.request_release_items
  WHERE release_id = p_release_id
    AND quantity_received IS DISTINCT FROM quantity_issued;

  IF p_dispute AND v_mismatches = 0 THEN
    RAISE EXCEPTION 'Every quantity matches what was issued — confirm the receipt instead of reporting a discrepancy';
  END IF;

  -- A mismatch is a dispute whether or not the button said so. Someone who
  -- edits a quantity and then hits Confirm has still reported a shortfall.
  v_new_ack := CASE WHEN p_dispute OR v_mismatches > 0 THEN 'disputed' ELSE 'confirmed' END;

  UPDATE gso_inventory.request_releases
  SET ack_status = v_new_ack,
      acknowledged_by = p_actor_id,
      acknowledged_at = now(),
      ack_remarks = NULLIF(btrim(COALESCE(p_remarks, '')), '')
  WHERE id = p_release_id;

  -- The cast is required, not decorative: both CASE branches are unknown-type
  -- literals, so the expression resolves to `text` and Postgres will not
  -- implicitly narrow that to the enum on the way into the column.
  INSERT INTO gso_inventory.request_logs (request_id, stage, action, actor_id, remarks)
  VALUES (
    v_request_id,
    v_request_status,
    (CASE WHEN v_new_ack = 'disputed' THEN 'disputed' ELSE 'received' END)
      ::gso_inventory.request_action,
    p_actor_id,
    NULLIF(btrim(COALESCE(p_remarks, '')), '')
  );

  -- The request did move, and the notification feed orders its queues by
  -- `updated_at`. Leaving it stale would keep a confirmed slip at the top of
  -- somebody's list.
  UPDATE gso_inventory.requests
  SET updated_at = now()
  WHERE id = v_request_id;

  RETURN v_new_ack::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION gso_inventory.acknowledge_release(UUID, UUID, JSONB, TEXT, BOOLEAN)
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- RLS + grants — same model as migration 1.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE gso_inventory.user_offices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read user_offices"
  ON gso_inventory.user_offices FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert user_offices"
  ON gso_inventory.user_offices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update user_offices"
  ON gso_inventory.user_offices FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete user_offices"
  ON gso_inventory.user_offices FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON gso_inventory.user_offices TO authenticated;
GRANT ALL ON gso_inventory.user_offices TO service_role;
