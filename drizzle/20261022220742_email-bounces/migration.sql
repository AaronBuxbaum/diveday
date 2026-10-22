CREATE TABLE "email_bounces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid,
	"provider_message_id" text NOT NULL,
	"event" text NOT NULL,
	"recipient" text NOT NULL,
	"bounce_type" text,
	"bounce_sub_type" text,
	"smtp_status" text,
	"complaint_type" text,
	"kind" text,
	"purpose" text,
	"sent_by_person_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_bounces_event_check" CHECK ("event" in ('bounce', 'complaint'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_bounces_event_unique" ON "email_bounces" ("provider_message_id","recipient","event");--> statement-breakpoint
CREATE INDEX "email_bounces_occurred_idx" ON "email_bounces" ("occurred_at");--> statement-breakpoint
CREATE INDEX "email_bounces_recipient_idx" ON "email_bounces" ("recipient");--> statement-breakpoint
ALTER TABLE "email_bounces" ADD CONSTRAINT "email_bounces_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_bounces" ADD CONSTRAINT "email_bounces_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;