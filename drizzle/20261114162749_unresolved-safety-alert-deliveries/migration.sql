CREATE TABLE "unresolved_safety_alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"outbox_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_id" uuid,
	"attempted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unresolved_safety_alert_delivery_status" CHECK ("status" in ('pending', 'sending', 'delivered', 'uncertain')),
	CONSTRAINT "unresolved_safety_alert_delivery_attempt_shape" CHECK (("status" = 'pending' and "attempt_id" is null and "attempted_at" is null and "delivered_at" is null and "provider_message_id" is null) or ("status" in ('sending', 'uncertain') and "attempt_id" is not null and "attempted_at" is not null and "delivered_at" is null and "provider_message_id" is null) or ("status" = 'delivered' and "attempt_id" is not null and "attempted_at" is not null and "delivered_at" is not null and "provider_message_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "unresolved_safety_alert_delivery_recipient_unique" ON "unresolved_safety_alert_deliveries" ("outbox_id","person_id");--> statement-breakpoint
ALTER TABLE "unresolved_safety_alert_deliveries" ADD CONSTRAINT "unresolved_safety_alert_deliveries_nrD84TjxkEBA_fkey" FOREIGN KEY ("outbox_id") REFERENCES "unresolved_safety_alert_outbox"("id");--> statement-breakpoint
ALTER TABLE "unresolved_safety_alert_deliveries" ADD CONSTRAINT "unresolved_safety_alert_deliveries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");