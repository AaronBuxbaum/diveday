-- diveday:allow-destructive drop-column interests.booked_booking_id: replaced by seat-level associations; no production caller, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-constraint interests.interests_booked_booking_id_bookings_id_fkey: replaced by tenant-scoped association foreign keys; no production caller, pre-pilot, no users (H-49)
-- diveday:allow-destructive drop-constraint interests.interests_booked_booking_is_date_offer: replaced by the seat-level association model; no production caller, pre-pilot, no users (H-49)
CREATE TABLE "date_request_offer_bookings" (
	"shop_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"booking_id" uuid PRIMARY KEY
);
--> statement-breakpoint
ALTER TABLE "interests" DROP CONSTRAINT "interests_booked_booking_id_bookings_id_fkey";--> statement-breakpoint
ALTER TABLE "interests" DROP CONSTRAINT "interests_booked_booking_is_date_offer";--> statement-breakpoint
DROP INDEX "interests_booked_booking_unique";--> statement-breakpoint
ALTER TABLE "interests" DROP COLUMN "booked_booking_id";--> statement-breakpoint
CREATE INDEX "date_request_offer_bookings_shop_interest_idx" ON "date_request_offer_bookings" ("shop_id","interest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interests_shop_id_id_unique" ON "interests" ("shop_id","id");--> statement-breakpoint
ALTER TABLE "date_request_offer_bookings" ADD CONSTRAINT "date_request_offer_bookings_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "date_request_offer_bookings" ADD CONSTRAINT "date_request_offer_bookings_interest_id_interests_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "date_request_offer_bookings" ADD CONSTRAINT "date_request_offer_bookings_shop_interest_fk" FOREIGN KEY ("shop_id","interest_id") REFERENCES "interests"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "date_request_offer_bookings" ADD CONSTRAINT "date_request_offer_bookings_shop_booking_fk" FOREIGN KEY ("shop_id","booking_id") REFERENCES "bookings"("shop_id","id") ON DELETE CASCADE;
