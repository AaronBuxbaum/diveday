-- diveday:allow-destructive add-column-not-null today_read_mark_events.shop_id: Today is absent from the previous production release; its immediately preceding migration creates this table empty before this column is added.
ALTER TABLE "today_read_mark_events" ADD COLUMN "shop_id" uuid NOT NULL;--> statement-breakpoint
CREATE INDEX "today_read_mark_events_shop_idx" ON "today_read_mark_events" ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "today_read_marks_shop_id_id_unique" ON "today_read_marks" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_desk_events_shop_id_id_unique" ON "trip_desk_events" ("shop_id","id");--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_shop_mark_fk" FOREIGN KEY ("shop_id","mark_id") REFERENCES "today_read_marks"("shop_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_shop_event_fk" FOREIGN KEY ("shop_id","event_id") REFERENCES "trip_desk_events"("shop_id","id") ON DELETE CASCADE;