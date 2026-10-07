CREATE TABLE "weekly_digest_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"week_of" date NOT NULL,
	"status" "notification_delivery_status",
	"unsubscribe_token_hash" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "weekly_digest" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_digest_sends_person_week_unique" ON "weekly_digest_sends" ("person_id","week_of");--> statement-breakpoint
CREATE INDEX "weekly_digest_sends_created_at_idx" ON "weekly_digest_sends" ("created_at");--> statement-breakpoint
ALTER TABLE "weekly_digest_sends" ADD CONSTRAINT "weekly_digest_sends_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "weekly_digest_sends" ADD CONSTRAINT "weekly_digest_sends_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;