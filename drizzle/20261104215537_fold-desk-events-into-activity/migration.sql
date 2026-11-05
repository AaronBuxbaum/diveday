-- Issue #2701: the crew's desk lines fold into activity_events, flagged by code (src/lib/activity.ts), with an audience column for the #1202 disclosure boundary; trip_read_marks.last_seen_seq and today_read_mark_events now point into activity_events.
-- diveday:allow-destructive drop-table trip_desk_events: every desk line is now an activity_events row (issue #2701); the previous release fails only a desk write (a check-in, a seat taken or given back) landing during the deploy itself, and the rows are a 30-day handoff with nothing to copy; pre-pilot, no users (H-20260815-no-legacy)
-- diveday:allow-destructive drop-type trip_desk_event_kind: only trip_desk_events.kind used it, dropped above in this migration (issue #2701)
-- diveday:allow-destructive drop-constraint today_read_mark_events.today_read_mark_events_event_id_trip_desk_events_id_fkey: its table is dropped in this migration; the marks it held are cleared first because they name lines that no longer exist (issue #2701)
-- diveday:allow-destructive drop-constraint today_read_mark_events.today_read_mark_events_shop_event_fk: re-added below against activity_events, after the marks naming dropped lines are cleared; dropped first because trip_desk_events cannot go while it stands (issue #2701)
-- diveday:allow-destructive drop-constraint activity_events.activity_events_actor_or_system_reason: re-added in the same atomic ALTER, wider only for desk-only codes the previous release never writes, so every row it writes passes both
-- diveday:allow-destructive delete-without-where today_read_mark_events: each row names a trip_desk_events line, which this migration drops; a Today mark with no acknowledgements shows the day's lines once more, which is the whole cost
-- diveday:allow-destructive delete-without-where trip_read_marks: each mark is a position in trip_desk_events.seq, meaningless against activity_events.seq; a person with no mark is shown nothing until they act or tap Got it, so clearing fails closed
CREATE TYPE "activity_audience" AS ENUM('staff', 'diver');--> statement-breakpoint
ALTER TABLE "today_read_mark_events" DROP CONSTRAINT "today_read_mark_events_event_id_trip_desk_events_id_fkey";--> statement-breakpoint
ALTER TABLE "today_read_mark_events" DROP CONSTRAINT "today_read_mark_events_shop_event_fk";--> statement-breakpoint
DELETE FROM "today_read_mark_events";--> statement-breakpoint
DELETE FROM "trip_read_marks";--> statement-breakpoint
DROP TABLE "trip_desk_events";--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "audience" "activity_audience" DEFAULT 'staff'::"activity_audience" NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_events_shop_trip_seq_idx" ON "activity_events" ("shop_id","trip_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_shop_id_id_unique" ON "activity_events" ("shop_id","id");--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_event_id_activity_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "activity_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_shop_event_fk" FOREIGN KEY ("shop_id","event_id") REFERENCES "activity_events"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_desk_is_staff" CHECK ("code" not in ('desk_running_late', 'desk_seat_released', 'desk_seat_turned_away', 'desk_balance_owed', 'desk_gear_changed', 'desk_pickup_set', 'desk_help_request', 'desk_meeting_point', 'desk_plan_changed') or "audience" = 'staff');--> statement-breakpoint
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_actor_or_system_reason", ADD CONSTRAINT "activity_events_actor_or_system_reason" CHECK (("actor_person_id" is null) = ("system_reason" is not null) or ("system_reason" is null and "code" in ('desk_running_late', 'desk_seat_released', 'desk_seat_turned_away', 'desk_balance_owed', 'desk_gear_changed', 'desk_pickup_set', 'desk_help_request', 'desk_meeting_point', 'desk_plan_changed')));--> statement-breakpoint
DROP TYPE "trip_desk_event_kind";