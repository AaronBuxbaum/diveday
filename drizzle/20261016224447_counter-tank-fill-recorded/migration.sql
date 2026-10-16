ALTER TABLE "gear_reservations" ADD COLUMN "fill_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD COLUMN "fill_recorded_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_fill_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("fill_recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "gear_reservations" ADD CONSTRAINT "gear_reservations_fill_recorded" CHECK (("fill_o2_percent" is null) = ("fill_recorded_at" is null));