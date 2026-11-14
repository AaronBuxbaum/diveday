ALTER TABLE "roll_call_event_claims" ADD COLUMN "unresolved_observation" jsonb;--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD COLUMN "unresolved_recorded_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD CONSTRAINT "roll_call_event_claims_4NwDSoR8G7Wg_fkey" FOREIGN KEY ("unresolved_recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD CONSTRAINT "roll_call_event_claims_observation_pair" CHECK (("unresolved_observation" is null) = ("unresolved_recorded_by_person_id" is null));--> statement-breakpoint
ALTER TABLE "roll_call_event_claims" ADD CONSTRAINT "roll_call_event_claims_observation_unresolved_only" CHECK ("state" = 'unresolved' or "unresolved_observation" is null);