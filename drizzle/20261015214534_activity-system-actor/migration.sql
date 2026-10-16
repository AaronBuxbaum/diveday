-- diveday:allow-destructive drop-constraint activity_events.activity_events_actor_present: shore-alert-contact is unreleased (same stack), so no live code relies on it; the new actor_or_system_reason check replaces it.
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_actor_present";--> statement-breakpoint
ALTER TABLE "activity_events" ADD COLUMN "system_reason" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_or_system_reason" CHECK (("actor_person_id" is null) = ("system_reason" is not null));