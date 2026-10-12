CREATE TYPE "lost_item_status" AS ENUM('open', 'returned', 'discarded');--> statement-breakpoint
CREATE TYPE "lost_item_told_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
ALTER TYPE "held_send_kind" ADD VALUE 'departure_note';--> statement-breakpoint
CREATE TABLE "departure_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"body" text NOT NULL,
	"sent_by_person_id" uuid,
	"recipients" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departure_notes_body_length" CHECK (length(trim("body")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "lost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"booking_id" uuid,
	"person_id" uuid,
	"description" text NOT NULL,
	"status" "lost_item_status" DEFAULT 'open'::"lost_item_status" NOT NULL,
	"recorded_by_person_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by_person_id" uuid,
	"told_at" timestamp with time zone,
	"told_channel" "lost_item_told_channel",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lost_items_description_length" CHECK (length(trim("description")) between 1 and 120),
	CONSTRAINT "lost_items_resolved_matches_status" CHECK (("status" = 'open') = ("resolved_at" is null)),
	CONSTRAINT "lost_items_seat_and_person_together" CHECK (("booking_id" is null) = ("person_id" is null))
);
--> statement-breakpoint
CREATE INDEX "departure_notes_shop_trip_idx" ON "departure_notes" ("shop_id","trip_id","sent_at");--> statement-breakpoint
CREATE INDEX "lost_items_shop_status_idx" ON "lost_items" ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "lost_items_shop_trip_idx" ON "lost_items" ("shop_id","trip_id");--> statement-breakpoint
ALTER TABLE "departure_notes" ADD CONSTRAINT "departure_notes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "departure_notes" ADD CONSTRAINT "departure_notes_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "departure_notes" ADD CONSTRAINT "departure_notes_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_resolved_by_person_id_people_id_fkey" FOREIGN KEY ("resolved_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;