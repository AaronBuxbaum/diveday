ALTER TABLE "shops" ADD COLUMN "rental_pricing" jsonb DEFAULT '{"setCents":null,"perItemCents":{},"nitroxCents":null}' NOT NULL;--> statement-breakpoint
ALTER TABLE "certifications" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "certifications" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "certification_status";--> statement-breakpoint
CREATE TYPE "certification_status" AS ENUM('pending', 'verified');--> statement-breakpoint
ALTER TABLE "certifications" ALTER COLUMN "status" SET DATA TYPE "certification_status" USING "status"::"certification_status";--> statement-breakpoint
ALTER TABLE "certifications" ALTER COLUMN "status" SET DEFAULT 'pending'::"certification_status";--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ALTER COLUMN "status" SET DATA TYPE "certification_status" USING "status"::"certification_status";--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ALTER COLUMN "status" SET DEFAULT 'pending'::"certification_status";--> statement-breakpoint
ALTER TABLE "specialty_certifications" ALTER COLUMN "status" SET DATA TYPE "certification_status" USING "status"::"certification_status";--> statement-breakpoint
ALTER TABLE "specialty_certifications" ALTER COLUMN "status" SET DEFAULT 'pending'::"certification_status";--> statement-breakpoint
ALTER TABLE "shops" ALTER COLUMN "packing_list" SET DEFAULT '["Swimsuit and towel","Reef-safe sun protection","Logbook"]';