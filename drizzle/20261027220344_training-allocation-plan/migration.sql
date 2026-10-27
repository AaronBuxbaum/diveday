ALTER TABLE "bookings" ADD COLUMN "training_plan_instructor_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_plan_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "training_plan_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD COLUMN "training_plan_instructor_person_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD COLUMN "training_plan_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD COLUMN "training_plan_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "bookings_training_plan_instructor_idx" ON "bookings" ("training_plan_instructor_person_id");--> statement-breakpoint
CREATE INDEX "bookings_training_plan_by_idx" ON "bookings" ("training_plan_by_person_id");--> statement-breakpoint
CREATE INDEX "trip_assignments_training_plan_instructor_idx" ON "trip_assignments" ("training_plan_instructor_person_id");--> statement-breakpoint
CREATE INDEX "trip_assignments_training_plan_by_idx" ON "trip_assignments" ("training_plan_by_person_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_plan_instructor_person_id_people_id_fkey" FOREIGN KEY ("training_plan_instructor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_training_plan_by_person_id_people_id_fkey" FOREIGN KEY ("training_plan_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_3aJnSAzIDZmj_fkey" FOREIGN KEY ("training_plan_instructor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_assignments" ADD CONSTRAINT "trip_assignments_training_plan_by_person_id_people_id_fkey" FOREIGN KEY ("training_plan_by_person_id") REFERENCES "people"("id");