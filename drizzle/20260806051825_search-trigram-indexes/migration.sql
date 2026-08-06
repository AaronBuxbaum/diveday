CREATE INDEX "courses_title_trgm_idx" ON "courses" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "dive_sites_location_trgm_idx" ON "dive_sites" USING gin ("location_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "orders_description_trgm_idx" ON "orders" USING gin ("description" gin_trgm_ops);