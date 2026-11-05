-- Issue #3782 item 4: a deal names a departure of its own shop. The composite key replaces the single-column one, which is the same promise minus the shop.
-- diveday:allow-destructive drop-constraint deals.deals_trip_id_trips_id_fkey: replaced in the same migration by deals_shop_trip_fk, which constrains the same column more tightly
ALTER TABLE "deals" DROP CONSTRAINT "deals_trip_id_trips_id_fkey";--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_shop_trip_fk" FOREIGN KEY ("shop_id","trip_id") REFERENCES "trips"("shop_id","id");