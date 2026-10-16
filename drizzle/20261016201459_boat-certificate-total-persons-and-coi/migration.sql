ALTER TABLE "boats" ADD COLUMN "certified_total_persons" integer;--> statement-breakpoint
ALTER TABLE "boats" ADD COLUMN "coi_expires_on" date;--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_certified_total_persons_positive" CHECK ("certified_total_persons" is null or "certified_total_persons" between 1 and 999);--> statement-breakpoint
ALTER TABLE "boats" ADD CONSTRAINT "boats_certified_passengers_within_total" CHECK ("certified_passengers" is null or "certified_total_persons" is null or "certified_passengers" <= "certified_total_persons");