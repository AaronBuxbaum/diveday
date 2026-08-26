ALTER TABLE "gear_reservations" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "gear_reservations" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "gear_reservations_person_idx" ON "gear_reservations" ("person_id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_one_holder" CHECK (("booking_id" is not null and "person_id" is null) or ("booking_id" is null and "person_id" is not null));