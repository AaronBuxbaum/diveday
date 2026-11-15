CREATE TABLE "computer_dive_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"dive_id" uuid NOT NULL,
	"samples" jsonb NOT NULL,
	CONSTRAINT "computer_profile_samples_bounded" CHECK (jsonb_array_length("samples") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "computer_dives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"record" jsonb NOT NULL,
	"annotation" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "computer_dives_annotation_bounded" CHECK (length("annotation") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "computer_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"selection_hash" text NOT NULL,
	"imported_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "computer_dive_profile_unique" ON "computer_dive_profiles" ("dive_id");--> statement-breakpoint
CREATE INDEX "computer_profile_person_idx" ON "computer_dive_profiles" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "computer_dives_fingerprint_unique" ON "computer_dives" ("shop_id","person_id","fingerprint");--> statement-breakpoint
CREATE INDEX "computer_dives_person_idx" ON "computer_dives" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "computer_import_request_unique" ON "computer_import_batches" ("shop_id","person_id","request_key");--> statement-breakpoint
CREATE INDEX "computer_import_person_idx" ON "computer_import_batches" ("person_id");--> statement-breakpoint
ALTER TABLE "computer_dive_profiles" ADD CONSTRAINT "computer_dive_profiles_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "computer_dive_profiles" ADD CONSTRAINT "computer_dive_profiles_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "computer_dive_profiles" ADD CONSTRAINT "computer_dive_profiles_dive_id_computer_dives_id_fkey" FOREIGN KEY ("dive_id") REFERENCES "computer_dives"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "computer_dives" ADD CONSTRAINT "computer_dives_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "computer_dives" ADD CONSTRAINT "computer_dives_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "computer_dives" ADD CONSTRAINT "computer_dives_batch_id_computer_import_batches_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "computer_import_batches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "computer_import_batches" ADD CONSTRAINT "computer_import_batches_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "computer_import_batches" ADD CONSTRAINT "computer_import_batches_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;