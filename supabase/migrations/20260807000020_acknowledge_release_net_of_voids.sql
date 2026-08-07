-- acknowledge_release must read "what was issued" net of voids.
--
-- Migration 19 added voids and taught the ledger, the issuance reports and the
-- printed receipt to net them off. It did not teach the acknowledgement, which
-- still compared against the raw `quantity_issued` in three places — and that
-- left the receiving office with no way to tell the truth:
--
--   * A plain confirm (no lines) wrote `quantity_received = quantity_issued`,
--     so an office handed 7 of 10 after a 3-unit void signed for all 10. The
--     one thing the second signature exists to prevent, produced by the button
--     labelled "everything arrived as issued".
--   * Entering the correct 7 counted as a mismatch against 10, so an accurate
--     receipt was recorded as `disputed` and lit GSO's discrepancy queue.
--   * The reasonless-dispute guard used the same comparison, so the office
--     could not report a real shortfall of 5 without the numbers being read
--     against a figure nobody claims went out.
--
-- The fix is one expression, applied consistently: `quantity_issued -
-- quantity_voided` is what left the warehouse, and it is the only figure
-- anybody should be asked to sign against. `quantity_issued` stays untouched
-- on the row — it is what the custodian recorded, and the void beside it is
-- the correction, exactly as migration 19 argued.
--
-- **Over-delivery stays uncapped**, and now covers a case it could not before:
-- GSO voids a line believing it was never handed over, the office says three
-- arrived anyway. That is `quantity_received = 3` against a net issue of 0 —
-- a mismatch, a dispute, and GSO's to settle. Refusing to record it would
-- force the office to sign for a number it knows is wrong, which is the same
-- objection that kept the cap off in the first place.
--
-- No backfill. The only voided line in the database when this was written had
-- `quantity_received` still NULL, so nothing has been mis-signed — and a
-- signature is not something a migration should be rewriting in any case.

SET search_path TO gso_inventory, public;

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
  v_actor_office UUID;
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

  SELECT office_id INTO v_actor_office
  FROM gso_inventory.user_profiles
  WHERE id = p_actor_id AND is_active;

  IF v_actor_office IS NULL OR v_actor_office <> v_office_id THEN
    RAISE EXCEPTION 'Only the receiving office can confirm this release';
  END IF;

  IF p_dispute AND (p_remarks IS NULL OR btrim(p_remarks) = '') THEN
    RAISE EXCEPTION 'Describe the discrepancy before reporting it';
  END IF;

  -- No lines supplied means "everything arrived as issued" -- and what was
  -- issued is what is left after any void, not what the custodian first wrote
  -- down. A voided unit never reached the office, so signing it as received
  -- would be the exact false signature this whole table exists to prevent.
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    UPDATE gso_inventory.request_release_items
    SET quantity_received = quantity_issued - quantity_voided
    WHERE release_id = p_release_id;
  ELSE
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      v_release_item_id := (v_line->>'release_item_id')::UUID;
      v_received := (v_line->>'quantity_received')::NUMERIC;

      IF v_received IS NULL OR v_received < 0 THEN
        RAISE EXCEPTION 'Received quantity cannot be negative';
      END IF;

      SELECT rli.quantity_issued - rli.quantity_voided
        INTO v_issued
      FROM gso_inventory.request_release_items rli
      WHERE rli.id = v_release_item_id AND rli.release_id = p_release_id
      FOR UPDATE OF rli;

      IF v_issued IS NULL THEN
        RAISE EXCEPTION 'That line does not belong to this release';
      END IF;

      -- Deliberately *not* capped at the net issued quantity. Over-delivery is
      -- a discrepancy too, and refusing to record it would leave the office
      -- choosing between signing for a number it knows is wrong and leaving
      -- the release unacknowledged. That now covers the case where GSO voided
      -- a line believing it never went out and the office says it did arrive.
      -- Nothing here touches stock either way -- GSO reconciles it with an
      -- adjustment.

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

  -- Against the net figure again, and for the sharper of the two reasons: an
  -- office that types the correct 7 against 10 issued and 3 voided was being
  -- recorded as reporting a discrepancy. A false dispute is worse than a
  -- missing one -- it lights a queue GSO then has to work through to discover
  -- that nothing was wrong.
  SELECT count(*) INTO v_mismatches
  FROM gso_inventory.request_release_items
  WHERE release_id = p_release_id
    AND quantity_received IS DISTINCT FROM (quantity_issued - quantity_voided);

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
    (CASE WHEN v_new_ack = 'disputed' THEN 'disputed' ELSE 'received' END)::gso_inventory.request_action,
    p_actor_id,
    NULLIF(btrim(COALESCE(p_remarks, '')), '')
  );

  RETURN v_new_ack::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION gso_inventory.acknowledge_release(UUID, UUID, JSONB, TEXT, BOOLEAN)
  TO authenticated, service_role;

-- Lines an office has already signed for where a void has since made the
-- signature disagree with what GSO says went out. Expected to be empty; a row
-- here is a release worth looking at by hand, not something to rewrite.
SELECT rel.id AS release_id,
       i.name AS item,
       rli.quantity_issued,
       rli.quantity_voided,
       rli.quantity_received
FROM gso_inventory.request_release_items rli
JOIN gso_inventory.request_releases rel ON rel.id = rli.release_id
JOIN gso_inventory.items i ON i.id = rli.item_id
WHERE rli.quantity_voided > 0
  AND rli.quantity_received IS DISTINCT FROM (rli.quantity_issued - rli.quantity_voided)
  AND rli.quantity_received IS NOT NULL;
