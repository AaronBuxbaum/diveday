ALTER TABLE "shops" ADD COLUMN "shore_alert_email" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "shore_alert_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "shore_alert_consent_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_shore_alert_consent" CHECK (("shore_alert_email" is null and "shore_alert_consent_at" is null
        and "shore_alert_consent_by_person_id" is null)
        or ("shore_alert_email" is not null and "shore_alert_consent_at" is not null
        and "shore_alert_consent_by_person_id" is not null));