ALTER TYPE "media_deletion_kind" ADD VALUE 'certification_card';--> statement-breakpoint
ALTER TYPE "media_deletion_kind" ADD VALUE 'waiver_document';--> statement-breakpoint
CREATE TABLE "roll_call_crew_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"checkpoint" text NOT NULL,
	"crew_aboard" integer NOT NULL,
	"crew_assigned" integer NOT NULL,
	"attested_by_person_id" uuid NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_whatsapp_accounts" (
	"shop_id" uuid PRIMARY KEY,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text,
	"waba_id" text,
	"access_token_sealed" text NOT NULL,
	"registration_pin_sealed" text,
	"template_name" text NOT NULL,
	"template_language" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "settled_total_cents" integer;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "anonymized_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "anonymized_by_person_id" uuid;--> statement-breakpoint
CREATE INDEX "roll_call_crew_attestations_shop_trip_checkpoint_occurred_idx" ON "roll_call_crew_attestations" ("shop_id","trip_id","checkpoint","occurred_at");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_attestations" ADD CONSTRAINT "roll_call_crew_attestations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_attestations" ADD CONSTRAINT "roll_call_crew_attestations_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "roll_call_crew_attestations" ADD CONSTRAINT "roll_call_crew_attestations_8HpD6wd6GQjn_fkey" FOREIGN KEY ("attested_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "shop_whatsapp_accounts" ADD CONSTRAINT "shop_whatsapp_accounts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_settled_total_nonnegative" CHECK ("settled_total_cents" is null or "settled_total_cents" >= 0);--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_anonymized_stays_removed" CHECK ("anonymized_at" is null or "deleted_at" is not null);