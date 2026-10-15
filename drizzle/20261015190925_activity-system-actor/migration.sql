ALTER TABLE "activity_events" ADD COLUMN "system_reason" text;--> statement-breakpoint
ALTER TABLE "activity_events" ALTER COLUMN "actor_person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_or_system_reason" CHECK (("actor_person_id" is null) = ("system_reason" is not null));