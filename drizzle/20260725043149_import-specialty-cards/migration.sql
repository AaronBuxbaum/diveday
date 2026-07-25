DROP INDEX "specialty_certifications_shop_agency_identifier_unique";--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD COLUMN "imported_from_label" text;--> statement-breakpoint
CREATE UNIQUE INDEX "specialty_certifications_shop_agency_specialty_identifier_unique" ON "specialty_certifications" ("shop_id","agency","specialty",lower("identifier")) WHERE "deleted_at" is null;