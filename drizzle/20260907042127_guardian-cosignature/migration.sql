ALTER TABLE "waiver_records" ADD COLUMN "guardian_name" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "guardian_relationship" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "guardian_email" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "guardian_signature_method" text;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "guardian_consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "guardian_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "draft_guardian" jsonb;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_guardian_signature_whole" CHECK (("guardian_signed_at" is null) = ("guardian_consented_at" is null)
        and ("guardian_signed_at" is null) = ("guardian_signature_method" is null)
        and ("guardian_signed_at" is null) = ("guardian_relationship" is null));