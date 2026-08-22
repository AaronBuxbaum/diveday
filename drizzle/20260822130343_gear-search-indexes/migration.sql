CREATE INDEX "gear_items_label_trgm_idx" ON "gear_items" USING gin ("label" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "gear_items_serial_trgm_idx" ON "gear_items" USING gin ("serial_number" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "gear_items_brand_model_trgm_idx" ON "gear_items" USING gin ("brand_model" gin_trgm_ops);