CREATE TABLE "private_person_photo_uploads" (
	"url" text PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"state" text NOT NULL,
	"put_finished" boolean DEFAULT false NOT NULL,
	"clean_after_put" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_cleanup_at" timestamp with time zone,
	"last_cleanup_error" text,
	CONSTRAINT "private_person_photo_uploads_state_check" CHECK ("state" in ('staged', 'active', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "diver_photo_path" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "diver_photo_suppressed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "private_person_photo_uploads_cleanup_idx" ON "private_person_photo_uploads" ("state","last_cleanup_at");--> statement-breakpoint
ALTER TABLE "private_person_photo_uploads" ADD CONSTRAINT "private_person_photo_uploads_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "private_person_photo_uploads" ADD CONSTRAINT "private_person_photo_uploads_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");