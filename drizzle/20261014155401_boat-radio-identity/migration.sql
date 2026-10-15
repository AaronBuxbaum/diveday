ALTER TABLE "boats" ADD COLUMN "call_sign" text;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "mmsi" text;--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_mmsi_nine_digits" CHECK ("mmsi" is null or "mmsi" ~ '^[0-9]{9}$');