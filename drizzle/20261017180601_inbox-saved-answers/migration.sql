CREATE TABLE "inbox_saved_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"source_person_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "inbox_saved_answers_shop_idx" ON "inbox_saved_answers" ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "inbox_saved_answers_source_person_idx" ON "inbox_saved_answers" ("shop_id","source_person_id");--> statement-breakpoint
ALTER TABLE "inbox_saved_answers" ADD CONSTRAINT "inbox_saved_answers_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "inbox_saved_answers" ADD CONSTRAINT "inbox_saved_answers_source_person_id_people_id_fkey" FOREIGN KEY ("source_person_id") REFERENCES "people"("id");