CREATE TYPE "dive_specialty" AS ENUM('deep', 'wreck', 'night', 'drysuit');--> statement-breakpoint
CREATE TABLE "specialty_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"specialty" "dive_specialty" NOT NULL,
	"identifier" text NOT NULL,
	"card_image_url" text,
	"expires_at" timestamp with time zone,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "minimum_certification_level" "certification_level";--> statement-breakpoint
ALTER TABLE "dive_sites" ADD COLUMN "required_specialties" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD COLUMN "required_specialties" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX "specialty_certifications_shop_person_idx" ON "specialty_certifications" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "specialty_certifications_shop_agency_identifier_unique" ON "specialty_certifications" ("shop_id","agency","identifier");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");