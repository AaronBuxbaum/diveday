CREATE TABLE "staff_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_shifts_ends_after_starts" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "default_locale" text DEFAULT 'en-US' NOT NULL;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "integrity_hash" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "integrity_version" integer;--> statement-breakpoint
CREATE INDEX "staff_shifts_shop_starts_idx" ON "staff_shifts" ("shop_id","starts_at");--> statement-breakpoint
CREATE INDEX "staff_shifts_person_starts_idx" ON "staff_shifts" ("person_id","starts_at");--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");