CREATE TYPE "calendar_feed_scope" AS ENUM('assignments', 'shop_trips');--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"scope" "calendar_feed_scope" NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "calendar_feeds_token_hash_idx" ON "calendar_feeds" ("token_hash");--> statement-breakpoint
CREATE INDEX "calendar_feeds_person_scope_idx" ON "calendar_feeds" ("person_id","scope","revoked_at");--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");