CREATE INDEX "trip_reviews_shop_person_idx" ON "trip_reviews" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "trip_dives_dive_site_idx" ON "trip_dives" ("dive_site_id");--> statement-breakpoint
CREATE INDEX "trips_course_starts_idx" ON "trips" ("course_id","starts_at");--> statement-breakpoint
CREATE INDEX "trips_boat_starts_idx" ON "trips" ("boat_id","starts_at");