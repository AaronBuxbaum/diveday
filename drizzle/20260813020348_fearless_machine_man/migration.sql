ALTER TABLE "trips" ADD COLUMN "minimum_bookings" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "minimum_decision_hours" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_minimum_bookings_range" CHECK ("minimum_bookings" is null or "minimum_bookings" between 1 and 60);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_minimum_decision_hours_range" CHECK ("minimum_decision_hours" is null or "minimum_decision_hours" between 1 and 336);