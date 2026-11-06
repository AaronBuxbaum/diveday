ALTER TABLE "roll_call_events" ADD COLUMN "retracts_event_id" uuid;--> statement-breakpoint
CREATE INDEX "roll_call_events_retracts_event_id_idx" ON "roll_call_events" ("retracts_event_id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_retracts_event_id_roll_call_events_id_fkey" FOREIGN KEY ("retracts_event_id") REFERENCES "roll_call_events"("id");--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_retracts_only_cleared" CHECK ("retracts_event_id" is null or "status" = 'cleared');