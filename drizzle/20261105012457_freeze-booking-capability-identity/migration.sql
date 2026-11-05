-- A booking link binds only its row id and purpose (issue #2711, ADR 20261104-derived-booking-link-tokens);
-- everything else it opens is read from the row. So the row's identity never changes after insert:
-- marking the browser's link delivered would give it the emailed link's reach (security review r5-4,
-- F1), and repointing a row would carry a live link across bookings. Revocation, expiry and a
-- receipt's device generation stay writable.
CREATE FUNCTION "booking_capabilities_identity_is_fixed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."shop_id" IS DISTINCT FROM OLD."shop_id"
    OR NEW."booking_id" IS DISTINCT FROM OLD."booking_id"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."delivered" IS DISTINCT FROM OLD."delivered"
    OR NEW."key_version" IS DISTINCT FROM OLD."key_version"
    OR NEW."source_capability_id" IS DISTINCT FROM OLD."source_capability_id" THEN
    RAISE EXCEPTION 'booking_capabilities identity columns are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "booking_capabilities_identity_is_fixed" BEFORE UPDATE ON "booking_capabilities" FOR EACH ROW EXECUTE FUNCTION "booking_capabilities_identity_is_fixed"();
