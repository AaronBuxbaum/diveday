CREATE TYPE "waiver_draft_door" AS ENUM('thread', 'counter', 'release');--> statement-breakpoint
CREATE TABLE "waiver_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"waiver_record_id" uuid NOT NULL,
	"door" "waiver_draft_door" NOT NULL,
	"link_id" uuid,
	"signer_name" text,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"medical_answers" jsonb,
	"guardian" jsonb,
	"shop_answers" jsonb,
	"medical_alert" text,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_drafts_door_unique" UNIQUE NULLS NOT DISTINCT("waiver_record_id","door","link_id"),
	CONSTRAINT "waiver_drafts_link_matches_door" CHECK (("door" = 'thread') = ("link_id" is null))
);
--> statement-breakpoint
CREATE INDEX "waiver_drafts_shop_idx" ON "waiver_drafts" ("shop_id");--> statement-breakpoint
ALTER TABLE "waiver_drafts" ADD CONSTRAINT "waiver_drafts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_drafts" ADD CONSTRAINT "waiver_drafts_waiver_record_id_waiver_records_id_fkey" FOREIGN KEY ("waiver_record_id") REFERENCES "waiver_records"("id") ON DELETE CASCADE;