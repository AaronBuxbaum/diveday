ALTER TABLE "certifications" ADD COLUMN "self_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD COLUMN "self_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certifications" ALTER COLUMN "identifier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ALTER COLUMN "identifier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_identifier_present_unless_self_declared" CHECK ("identifier" is not null or ("self_declared_at" is not null and "status" = 'pending'));--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_identifier_present_unless_self_declared" CHECK ("identifier" is not null or ("self_declared_at" is not null and "status" = 'pending'));