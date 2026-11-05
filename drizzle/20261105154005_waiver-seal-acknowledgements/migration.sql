-- The schema stopped declaring booking_capabilities.token_hash and token_sealed
-- (#3901) and waiver_records.token_sealed (#3903) in this release; the
-- destructive-migration guard refuses their drop while main still declares
-- them, so drizzle's generated drops are left out here and follow next release.
-- Nothing writes them any more, so nothing would null them either: clear every
-- stored copy now, so a dump taken before the drop holds no openable link.
UPDATE "waiver_records" SET "token_sealed" = NULL WHERE "token_sealed" IS NOT NULL;--> statement-breakpoint
UPDATE "booking_capabilities" SET "token_sealed" = NULL, "token_hash" = NULL WHERE "token_sealed" IS NOT NULL OR "token_hash" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "waiver_seal_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"waiver_record_id" uuid NOT NULL,
	"state_digest" text NOT NULL,
	"note" text NOT NULL,
	"acknowledged_by_person_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_seal_acknowledgements_note_length" CHECK (length(btrim("note")) > 0 and length("note") <= 1000)
);
--> statement-breakpoint
CREATE INDEX "waiver_seal_acknowledgements_record_idx" ON "waiver_seal_acknowledgements" ("shop_id","waiver_record_id");--> statement-breakpoint
CREATE INDEX "waiver_seal_acknowledgements_by_idx" ON "waiver_seal_acknowledgements" ("acknowledged_by_person_id");--> statement-breakpoint
ALTER TABLE "waiver_seal_acknowledgements" ADD CONSTRAINT "waiver_seal_acknowledgements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_seal_acknowledgements" ADD CONSTRAINT "waiver_seal_acknowledgements_NN3djjfCQh3p_fkey" FOREIGN KEY ("waiver_record_id") REFERENCES "waiver_records"("id");--> statement-breakpoint
ALTER TABLE "waiver_seal_acknowledgements" ADD CONSTRAINT "waiver_seal_acknowledgements_DlT31GsEUgIV_fkey" FOREIGN KEY ("acknowledged_by_person_id") REFERENCES "people"("id");