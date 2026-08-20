CREATE TYPE "trip_invitation_source" AS ENUM('date_request', 'waitlist', 'direct');--> statement-breakpoint
CREATE TABLE "trip_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"source" "trip_invitation_source" NOT NULL,
	"course_inquiry_id" uuid,
	"waitlist_entry_id" uuid,
	"person_id" uuid,
	"created_by_person_id" uuid NOT NULL,
	"invited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_invitations_source_reference_check" CHECK ((
        ("source" = 'date_request' and "course_inquiry_id" is not null and "waitlist_entry_id" is null and "person_id" is null)
        or ("source" = 'waitlist' and "course_inquiry_id" is null and "waitlist_entry_id" is not null and "person_id" is null)
        or ("source" = 'direct' and "course_inquiry_id" is null and "waitlist_entry_id" is null and "person_id" is not null)
      ))
);
--> statement-breakpoint
CREATE INDEX "trip_invitations_shop_trip_idx" ON "trip_invitations" ("shop_id","trip_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_invitations_trip_request_unique" ON "trip_invitations" ("trip_id","course_inquiry_id") WHERE "course_inquiry_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_invitations_trip_waitlist_unique" ON "trip_invitations" ("trip_id","waitlist_entry_id") WHERE "waitlist_entry_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_invitations_trip_person_unique" ON "trip_invitations" ("trip_id","person_id") WHERE "person_id" is not null;--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_course_inquiry_id_course_inquiries_id_fkey" FOREIGN KEY ("course_inquiry_id") REFERENCES "course_inquiries"("id");--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_ARj7Ut08RxVu_fkey" FOREIGN KEY ("waitlist_entry_id") REFERENCES "trip_waitlist_entries"("id");--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_invitations" ADD CONSTRAINT "trip_invitations_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");