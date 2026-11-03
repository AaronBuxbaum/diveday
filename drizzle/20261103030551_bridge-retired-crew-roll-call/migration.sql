-- Expand/contract bridge for issue #2700 (ADR 20261103-one-roll-call-ledger). Crew marks now live
-- in roll_call_events (subject_kind = 'crew'). The release still serving while this migration runs
-- writes crew marks to roll_call_crew_events; this copies what is there and forwards every later
-- write, so a crew member counted "not back aboard" during the deploy never reads as awaiting.
-- An update (the old release's erasure scrub) and a delete (its purges) follow the row by id, so an
-- erasure run on the outgoing release reaches the copy. Conflicts name the id only: a crew mark
-- whose client id a seat mark already holds fails loudly instead of vanishing.
-- The table, this trigger and its function are dropped together in the next release.
INSERT INTO "roll_call_events" ("id", "shop_id", "trip_id", "subject_kind", "crew_person_id", "recorded_by_person_id", "status", "checkpoint", "source", "client_event_id", "note", "credential_snapshot", "credential_snapshot_started_at", "credential_snapshot_captured_at", "occurred_at", "created_at")
SELECT "id", "shop_id", "trip_id", 'crew', "person_id", "recorded_by_person_id", "status", "checkpoint", "source", "client_event_id", "note", "credential_snapshot", "credential_snapshot_started_at", "credential_snapshot_captured_at", "occurred_at", "created_at"
FROM "roll_call_crew_events" ORDER BY "seq"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
CREATE FUNCTION "forward_retired_crew_roll_call"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "roll_call_events" WHERE "id" = OLD."id" AND "subject_kind" = 'crew';
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    UPDATE "roll_call_events" SET "note" = NEW."note", "credential_snapshot" = NEW."credential_snapshot",
      "credential_snapshot_started_at" = NEW."credential_snapshot_started_at",
      "credential_snapshot_captured_at" = NEW."credential_snapshot_captured_at"
    WHERE "id" = NEW."id" AND "subject_kind" = 'crew';
    RETURN NEW;
  END IF;
  INSERT INTO "roll_call_events" ("id", "shop_id", "trip_id", "subject_kind", "crew_person_id", "recorded_by_person_id", "status", "checkpoint", "source", "client_event_id", "note", "credential_snapshot", "credential_snapshot_started_at", "credential_snapshot_captured_at", "occurred_at", "created_at")
  VALUES (NEW."id", NEW."shop_id", NEW."trip_id", 'crew', NEW."person_id", NEW."recorded_by_person_id", NEW."status", NEW."checkpoint", NEW."source", NEW."client_event_id", NEW."note", NEW."credential_snapshot", NEW."credential_snapshot_started_at", NEW."credential_snapshot_captured_at", NEW."occurred_at", NEW."created_at")
  ON CONFLICT ("id") DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "forward_retired_crew_roll_call" AFTER INSERT OR UPDATE OR DELETE ON "roll_call_crew_events" FOR EACH ROW EXECUTE FUNCTION "forward_retired_crew_roll_call"();
