CREATE TABLE "today_read_mark_events" (
	"mark_id" uuid NOT NULL,
	"event_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "today_read_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"day_start" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "today_read_mark_events_unique" ON "today_read_mark_events" ("mark_id","event_id");--> statement-breakpoint
CREATE INDEX "today_read_mark_events_event_idx" ON "today_read_mark_events" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "today_read_marks_shop_person_day_unique" ON "today_read_marks" ("shop_id","person_id","day_start");--> statement-breakpoint
CREATE INDEX "today_read_marks_person_idx" ON "today_read_marks" ("person_id");--> statement-breakpoint
CREATE INDEX "today_read_marks_seen_idx" ON "today_read_marks" ("last_seen_at");--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_mark_id_today_read_marks_id_fkey" FOREIGN KEY ("mark_id") REFERENCES "today_read_marks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_mark_events" ADD CONSTRAINT "today_read_mark_events_event_id_trip_desk_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "trip_desk_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_marks" ADD CONSTRAINT "today_read_marks_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "today_read_marks" ADD CONSTRAINT "today_read_marks_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE;