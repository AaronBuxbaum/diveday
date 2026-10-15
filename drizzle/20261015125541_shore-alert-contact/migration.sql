CREATE TABLE "shop_shore_alert_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_shore_alert_tokens_purpose" CHECK ("purpose" in ('confirm', 'stop')),
	CONSTRAINT "shop_shore_alert_tokens_expiry" CHECK (("purpose" = 'confirm') = ("expires_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "shore_alert_email" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "shore_alert_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "shore_alert_consent_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "shore_alert_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "roll_call_shore_alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_events" ALTER COLUMN "actor_person_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "shop_shore_alert_tokens_shop_idx" ON "shop_shore_alert_tokens" ("shop_id");--> statement-breakpoint
ALTER TABLE "shop_shore_alert_tokens" ADD CONSTRAINT "shop_shore_alert_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_present" CHECK ("actor_person_id" is not null or "code" = 'shore_alert_contact_stopped');--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_shore_alert_consent" CHECK (("shore_alert_email" is null and "shore_alert_consent_at" is null
        and "shore_alert_consent_by_person_id" is null)
        or ("shore_alert_email" is not null and "shore_alert_consent_at" is not null
        and "shore_alert_consent_by_person_id" is not null));--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_shore_alert_confirmed_has_address" CHECK ("shore_alert_confirmed_at" is null or "shore_alert_email" is not null);