ALTER TABLE "certifications" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX "certifications_shop_agency_identifier_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "certifications_shop_agency_identifier_unique" ON "certifications" ("shop_id","agency","identifier") WHERE "deleted_at" is null;--> statement-breakpoint
DROP INDEX "nitrox_certifications_shop_agency_identifier_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "nitrox_certifications_shop_agency_identifier_unique" ON "nitrox_certifications" ("shop_id","agency","identifier") WHERE "deleted_at" is null;--> statement-breakpoint
DROP INDEX "specialty_certifications_shop_agency_identifier_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "specialty_certifications_shop_agency_identifier_unique" ON "specialty_certifications" ("shop_id","agency","identifier") WHERE "deleted_at" is null;