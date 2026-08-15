ALTER TABLE "roll_call_crew_events" ADD COLUMN "source" "roll_call_source" DEFAULT 'live'::"roll_call_source" NOT NULL;--> statement-breakpoint
ALTER TABLE "roll_call_crew_events" ADD COLUMN "client_event_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "roll_call_crew_events_shop_client_event_unique" ON "roll_call_crew_events" ("shop_id","client_event_id");