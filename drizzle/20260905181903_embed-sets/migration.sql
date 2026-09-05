CREATE TYPE "embed_set_kind" AS ENUM('trip', 'course');--> statement-breakpoint
CREATE TABLE "embed_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "embed_set_kind" NOT NULL,
	"member_ids" jsonb DEFAULT '[]' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embed_sets_name_present" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "embed_sets_member_count" CHECK (jsonb_array_length("member_ids") between 1 and 24)
);
--> statement-breakpoint
CREATE INDEX "embed_sets_shop_live_idx" ON "embed_sets" ("shop_id","name") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "embed_sets" ADD CONSTRAINT "embed_sets_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");