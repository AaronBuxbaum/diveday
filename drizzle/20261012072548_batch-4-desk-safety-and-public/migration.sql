CREATE TYPE "lost_item_status" AS ENUM('open', 'returned', 'discarded');--> statement-breakpoint
CREATE TYPE "lost_item_told_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "incident_handover_kind" AS ENUM('none', 'ems', 'hospital', 'chamber', 'diver', 'other');--> statement-breakpoint
CREATE TYPE "incident_involvement" AS ENUM('affected', 'witness', 'responder');--> statement-breakpoint
CREATE TYPE "incident_report_status" AS ENUM('draft', 'filed');--> statement-breakpoint
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
CREATE TABLE "incident_report_addenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_report_addenda_body_not_blank" CHECK (length(trim("body")) > 0),
	CONSTRAINT "incident_report_addenda_body_length" CHECK (length("body") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "incident_report_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"booking_id" uuid,
	"person_id" uuid,
	"outsider_name" text,
	"involvement" "incident_involvement" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_report_people_one_subject" CHECK (num_nonnulls("booking_id", "person_id", "outsider_name") = 1),
	CONSTRAINT "incident_report_people_outsider_name_length" CHECK ("outsider_name" is null or length("outsider_name") <= 200)
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"status" "incident_report_status" DEFAULT 'draft'::"incident_report_status" NOT NULL,
	"occurred_at" timestamp with time zone,
	"dive_site_id" uuid,
	"location_text" text,
	"what_happened" text,
	"first_aid_given" boolean,
	"oxygen_given" boolean,
	"oxygen_minutes" integer,
	"emergency_services_called" boolean,
	"handover_kind" "incident_handover_kind",
	"handover_detail" text,
	"handed_over_at" timestamp with time zone,
	"follow_up" text,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filed_at" timestamp with time zone,
	"filed_by_person_id" uuid,
	CONSTRAINT "incident_reports_oxygen_minutes" CHECK ("oxygen_minutes" is null or ("oxygen_given" is true and "oxygen_minutes" between 1 and 1440)),
	CONSTRAINT "incident_reports_filed_complete" CHECK ("status" = 'draft' or (
        "filed_at" is not null and "filed_by_person_id" is not null
        and "occurred_at" is not null and "what_happened" is not null
        and "first_aid_given" is not null and "oxygen_given" is not null
        and "emergency_services_called" is not null
        and ("dive_site_id" is not null or "location_text" is not null)
        and ("handover_kind" is not null
          or ("emergency_services_called" is false and "oxygen_given" is false))
      ))
);
--> statement-breakpoint
CREATE TABLE "review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"body" text NOT NULL,
	"written_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "review_replies_body_length" CHECK (length(trim("body")) between 1 and 400)
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "is_rehearsal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "departure_notes_shop_trip_idx" ON "departure_notes" ("shop_id","trip_id","sent_at");--> statement-breakpoint
CREATE INDEX "lost_items_shop_status_idx" ON "lost_items" ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "lost_items_shop_trip_idx" ON "lost_items" ("shop_id","trip_id");--> statement-breakpoint
CREATE INDEX "incident_report_addenda_report_idx" ON "incident_report_addenda" ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_report_people_report_idx" ON "incident_report_people" ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_report_people_booking_idx" ON "incident_report_people" ("booking_id");--> statement-breakpoint
CREATE INDEX "incident_reports_shop_trip_idx" ON "incident_reports" ("shop_id","trip_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_reports_shop_occurred_idx" ON "incident_reports" ("shop_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_replies_review_live_unique" ON "review_replies" ("review_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "review_replies_shop_idx" ON "review_replies" ("shop_id");--> statement-breakpoint
ALTER TABLE "departure_notes" ADD CONSTRAINT "departure_notes_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "departure_notes" ADD CONSTRAINT "departure_notes_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "departure_notes" ADD CONSTRAINT "departure_notes_sent_by_person_id_people_id_fkey" FOREIGN KEY ("sent_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lost_items" ADD CONSTRAINT "lost_items_resolved_by_person_id_people_id_fkey" FOREIGN KEY ("resolved_by_person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "incident_report_addenda" ADD CONSTRAINT "incident_report_addenda_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "incident_report_addenda" ADD CONSTRAINT "incident_report_addenda_report_id_incident_reports_id_fkey" FOREIGN KEY ("report_id") REFERENCES "incident_reports"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_report_addenda" ADD CONSTRAINT "incident_report_addenda_author_person_id_people_id_fkey" FOREIGN KEY ("author_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_report_people" ADD CONSTRAINT "incident_report_people_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "incident_report_people" ADD CONSTRAINT "incident_report_people_report_id_incident_reports_id_fkey" FOREIGN KEY ("report_id") REFERENCES "incident_reports"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "incident_report_people" ADD CONSTRAINT "incident_report_people_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "incident_report_people" ADD CONSTRAINT "incident_report_people_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_dive_site_id_dive_sites_id_fkey" FOREIGN KEY ("dive_site_id") REFERENCES "dive_sites"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_filed_by_person_id_people_id_fkey" FOREIGN KEY ("filed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_id_trip_reviews_id_fkey" FOREIGN KEY ("review_id") REFERENCES "trip_reviews"("id");--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_written_by_person_id_people_id_fkey" FOREIGN KEY ("written_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_rehearsal_is_private" CHECK (not "is_rehearsal" or "is_private");