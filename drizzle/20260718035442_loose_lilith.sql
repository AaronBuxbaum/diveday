CREATE TYPE "public"."roll_call_status" AS ENUM('boarded', 'not_boarded');--> statement-breakpoint
CREATE TABLE "roll_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"status" "roll_call_status" NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_call_events" ADD CONSTRAINT "roll_call_events_recorded_by_person_id_people_id_fk" FOREIGN KEY ("recorded_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roll_call_events_shop_trip_booking_created_idx" ON "roll_call_events" USING btree ("shop_id","trip_id","booking_id","created_at");