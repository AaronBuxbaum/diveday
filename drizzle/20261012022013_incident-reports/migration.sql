CREATE TYPE "incident_handover_kind" AS ENUM('ems', 'hospital', 'chamber', 'diver', 'other');--> statement-breakpoint
CREATE TYPE "incident_involvement" AS ENUM('affected', 'witness', 'responder');--> statement-breakpoint
CREATE TYPE "incident_report_status" AS ENUM('draft', 'filed');--> statement-breakpoint
CREATE TABLE "incident_report_addenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_report_addenda_body_not_blank" CHECK (length(trim("body")) > 0)
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
	CONSTRAINT "incident_report_people_one_subject" CHECK (num_nonnulls("booking_id", "person_id", "outsider_name") = 1)
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
	CONSTRAINT "incident_reports_oxygen_minutes" CHECK ("oxygen_minutes" is null or ("oxygen_given" is true and "oxygen_minutes" between 0 and 1440)),
	CONSTRAINT "incident_reports_filed_complete" CHECK ("status" = 'draft' or (
        "filed_at" is not null and "filed_by_person_id" is not null
        and "occurred_at" is not null and "what_happened" is not null
        and "first_aid_given" is not null and "oxygen_given" is not null
        and "emergency_services_called" is not null
      ))
);
--> statement-breakpoint
CREATE INDEX "incident_report_addenda_report_idx" ON "incident_report_addenda" ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_report_people_report_idx" ON "incident_report_people" ("report_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_report_people_booking_idx" ON "incident_report_people" ("booking_id");--> statement-breakpoint
CREATE INDEX "incident_reports_shop_trip_idx" ON "incident_reports" ("shop_id","trip_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_reports_shop_occurred_idx" ON "incident_reports" ("shop_id","occurred_at");--> statement-breakpoint
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
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_filed_by_person_id_people_id_fkey" FOREIGN KEY ("filed_by_person_id") REFERENCES "people"("id");