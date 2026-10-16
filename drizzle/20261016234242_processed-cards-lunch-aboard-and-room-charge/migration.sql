ALTER TYPE "order_collection" ADD VALUE 'room_charge';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "dietary_note" text;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "processed_with_agency_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "processed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD COLUMN "processed_with_agency_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD COLUMN "processed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD COLUMN "processed_with_agency_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD COLUMN "processed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "room_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "room_hotel" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "lunch_aboard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "certifications_processed_by_person_idx" ON "certifications" ("processed_by_person_id") WHERE "processed_by_person_id" is not null;--> statement-breakpoint
CREATE INDEX "nitrox_certifications_processed_by_person_idx" ON "nitrox_certifications" ("processed_by_person_id") WHERE "processed_by_person_id" is not null;--> statement-breakpoint
CREATE INDEX "specialty_certifications_processed_by_person_idx" ON "specialty_certifications" ("processed_by_person_id") WHERE "processed_by_person_id" is not null;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_processed_by_person_id_people_id_fkey" FOREIGN KEY ("processed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_processed_by_person_id_people_id_fkey" FOREIGN KEY ("processed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_processed_by_person_id_people_id_fkey" FOREIGN KEY ("processed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_processed_only_when_issued" CHECK ("processed_with_agency_at" is null or "issued_by_shop_at" is not null);--> statement-breakpoint
ALTER TABLE "nitrox_certifications" ADD CONSTRAINT "nitrox_certifications_processed_only_when_issued" CHECK ("processed_with_agency_at" is null or "issued_by_shop_at" is not null);--> statement-breakpoint
ALTER TABLE "specialty_certifications" ADD CONSTRAINT "specialty_certifications_processed_only_when_issued" CHECK ("processed_with_agency_at" is null or "issued_by_shop_at" is not null);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_room_charge_names_room" CHECK (("collection"::text = 'room_charge') = ("room_number" is not null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_room_hotel_only_on_room_charge" CHECK ("room_hotel" is null or "collection"::text = 'room_charge');