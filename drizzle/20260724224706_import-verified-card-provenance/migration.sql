ALTER TABLE "certifications" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "imported_from_label" text;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD COLUMN "imported_from_label" text;