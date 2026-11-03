CREATE TYPE "capability_purpose" AS ENUM('interest_unsubscribe', 'courtesy_email_unsubscribe');--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"purpose" "capability_purpose" NOT NULL,
	"shop_id" uuid NOT NULL,
	"person_id" uuid,
	"interest_id" uuid,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capabilities_subject_by_purpose" CHECK (("purpose" = 'interest_unsubscribe' and "interest_id" is not null and "person_id" is null)
        or ("purpose" = 'courtesy_email_unsubscribe' and "person_id" is not null and "interest_id" is null))
);
--> statement-breakpoint
INSERT INTO "capabilities" ("purpose", "shop_id", "person_id", "token_hash", "issued_at") SELECT 'courtesy_email_unsubscribe', "shop_id", "person_id", "token_hash", "issued_at" FROM "person_courtesy_email_unsubscribe_tokens";--> statement-breakpoint
INSERT INTO "capabilities" ("purpose", "shop_id", "interest_id", "token_hash", "issued_at") SELECT 'interest_unsubscribe', "shop_id", "interest_id", "token_hash", "issued_at" FROM "interest_unsubscribe_tokens";--> statement-breakpoint
-- diveday:allow-destructive drop-table person_courtesy_email_unsubscribe_tokens: its rows are copied into capabilities above (issue #2710), so a link already mailed still unsubscribes; the previous release only fails a courtesy send or unsubscribe during the deploy itself; pre-pilot, no users (H-20260815-no-legacy)
DROP TABLE "person_courtesy_email_unsubscribe_tokens";--> statement-breakpoint
-- diveday:allow-destructive drop-table interest_unsubscribe_tokens: its rows are copied into capabilities above (issue #2710), so a link already mailed still unsubscribes; the previous release only fails a deal send or unsubscribe during the deploy itself; pre-pilot, no users (H-20260815-no-legacy)
DROP TABLE "interest_unsubscribe_tokens";--> statement-breakpoint
CREATE INDEX "capabilities_person_idx" ON "capabilities" ("person_id");--> statement-breakpoint
CREATE INDEX "capabilities_interest_idx" ON "capabilities" ("interest_id");--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_interest_id_interests_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id");