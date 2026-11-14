-- Database backstop for old and direct schedule writers. Generation is a
-- monotonic invalidation token, not a count of edits.
CREATE FUNCTION "guard_meeting_schedule_generation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."meeting_schedule_generation" < OLD."meeting_schedule_generation" THEN
    RAISE EXCEPTION 'meeting schedule generation cannot decrease' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."starts_at" IS DISTINCT FROM OLD."starts_at" OR NEW."ends_at" IS DISTINCT FROM OLD."ends_at" THEN
    NEW."meeting_schedule_generation" := GREATEST(NEW."meeting_schedule_generation", OLD."meeting_schedule_generation" + 1);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "guard_meeting_schedule_generation" BEFORE UPDATE OF "starts_at", "ends_at", "meeting_schedule_generation" ON "trips" FOR EACH ROW EXECUTE FUNCTION "guard_meeting_schedule_generation"();--> statement-breakpoint
CREATE FUNCTION "advance_meeting_generation_for_day"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."trip_id" IS NOT DISTINCT FROM OLD."trip_id"
    AND NEW."day_number" IS NOT DISTINCT FROM OLD."day_number"
    AND NEW."starts_at" IS NOT DISTINCT FROM OLD."starts_at"
    AND NEW."ends_at" IS NOT DISTINCT FROM OLD."ends_at" THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE "trips" SET "meeting_schedule_generation" = "meeting_schedule_generation" + 1 WHERE "id" = OLD."trip_id";
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."trip_id" IS DISTINCT FROM NEW."trip_id" THEN
    UPDATE "trips" SET "meeting_schedule_generation" = "meeting_schedule_generation" + 1 WHERE "id" = OLD."trip_id";
  END IF;
  UPDATE "trips" SET "meeting_schedule_generation" = "meeting_schedule_generation" + 1 WHERE "id" = NEW."trip_id";
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "advance_meeting_generation_for_day" AFTER INSERT OR UPDATE OR DELETE ON "trip_schedule_days" FOR EACH ROW EXECUTE FUNCTION "advance_meeting_generation_for_day"();--> statement-breakpoint
CREATE FUNCTION "advance_meeting_generations_for_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "trips" SET "meeting_schedule_generation" = "meeting_schedule_generation" + 1;
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- diveday:allow-destructive truncate trip_schedule_days: This installs a trigger and does not truncate any rows.
CREATE TRIGGER "advance_meeting_generations_for_truncate" AFTER TRUNCATE ON "trip_schedule_days" FOR EACH STATEMENT EXECUTE FUNCTION "advance_meeting_generations_for_truncate"();
