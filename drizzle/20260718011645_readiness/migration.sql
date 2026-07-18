CREATE TYPE "public"."certification_agency" AS ENUM('padi', 'ssi', 'naui', 'sdi', 'tdi', 'other');--> statement-breakpoint
CREATE TYPE "public"."certification_level" AS ENUM('open_water', 'advanced_open_water', 'rescue', 'divemaster', 'instructor');--> statement-breakpoint
CREATE TYPE "public"."certification_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"level" "certification_level" NOT NULL,
	"identifier" text NOT NULL,
	"card_image_url" text,
	"expires_at" timestamp with time zone,
	"status" "certification_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_requirements" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"requires_waiver" boolean DEFAULT true NOT NULL,
	"minimum_certification_level" "certification_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD CONSTRAINT "trip_requirements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_requirements" ADD CONSTRAINT "trip_requirements_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifications_shop_person_idx" ON "certifications" USING btree ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certifications_shop_agency_identifier_unique" ON "certifications" USING btree ("shop_id","agency","identifier");--> statement-breakpoint
CREATE INDEX "trip_requirements_shop_idx" ON "trip_requirements" USING btree ("shop_id");