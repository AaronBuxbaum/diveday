CREATE TABLE "unresolved_safety_alert_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unresolved_safety_alert_outbox_generation_unique" ON "unresolved_safety_alert_outbox" ("generation_id");--> statement-breakpoint
CREATE INDEX "unresolved_safety_alert_outbox_shop_trip_idx" ON "unresolved_safety_alert_outbox" ("shop_id","trip_id");--> statement-breakpoint
ALTER TABLE "unresolved_safety_alert_outbox" ADD CONSTRAINT "unresolved_safety_alert_outbox_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "unresolved_safety_alert_outbox" ADD CONSTRAINT "unresolved_safety_alert_outbox_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "unresolved_safety_alert_outbox" ADD CONSTRAINT "unresolved_safety_alert_outbox_sElnacRFkZdi_fkey" FOREIGN KEY ("claim_id") REFERENCES "roll_call_event_claims"("id");