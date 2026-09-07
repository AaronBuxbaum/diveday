CREATE TABLE "form_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"form" text NOT NULL,
	"fields" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "form_drafts_person_form_unique" ON "form_drafts" ("shop_id","person_id","form");--> statement-breakpoint
CREATE INDEX "form_drafts_saved_at_idx" ON "form_drafts" ("saved_at");--> statement-breakpoint
ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;