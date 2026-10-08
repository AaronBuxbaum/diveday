CREATE TABLE "course_form_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"form_version_id" uuid NOT NULL,
	"form_title" text NOT NULL,
	"form_version" integer NOT NULL,
	"form_body" text NOT NULL,
	"signed_name" text,
	"signature_method" text NOT NULL,
	"recorded_by_person_id" uuid,
	"consented_at" timestamp with time zone NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"guardian_name" text,
	"guardian_relationship" text,
	"guardian_signature_method" text,
	"guardian_consented_at" timestamp with time zone,
	"guardian_signed_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"anonymized_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_form_records_signature_method_known" CHECK ("signature_method" in ('typed_consent', 'in_person_attested', 'in_person_attested_namesake')),
	CONSTRAINT "course_form_records_paper_attributed" CHECK (("signature_method" = 'typed_consent') = ("recorded_by_person_id" is null)),
	CONSTRAINT "course_form_records_signed_name_present" CHECK ("signed_name" is not null or "anonymized_at" is not null),
	CONSTRAINT "course_form_records_guardian_signature_whole" CHECK (("guardian_signed_at" is null) = ("guardian_consented_at" is null)
        and ("guardian_signed_at" is null) = ("guardian_signature_method" is null)
        and ("guardian_signed_at" is null) = ("guardian_relationship" is null))
);
--> statement-breakpoint
CREATE TABLE "course_form_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "course_form_records_booking_version_unique" ON "course_form_records" ("booking_id","form_version_id");--> statement-breakpoint
CREATE INDEX "course_form_records_shop_booking_idx" ON "course_form_records" ("shop_id","booking_id");--> statement-breakpoint
CREATE INDEX "course_form_records_shop_person_idx" ON "course_form_records" ("shop_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_form_requirements_live_unique" ON "course_form_requirements" ("course_id","form_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "course_form_requirements_shop_course_idx" ON "course_form_requirements" ("shop_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_form_versions_form_version_unique" ON "course_form_versions" ("form_id","version");--> statement-breakpoint
CREATE INDEX "course_form_versions_shop_form_idx" ON "course_form_versions" ("shop_id","form_id");--> statement-breakpoint
CREATE INDEX "course_forms_shop_live_idx" ON "course_forms" ("shop_id") WHERE "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_form_id_course_forms_id_fkey" FOREIGN KEY ("form_id") REFERENCES "course_forms"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_Ynzi8aSsVWKW_fkey" FOREIGN KEY ("form_version_id") REFERENCES "course_form_versions"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_form_records" ADD CONSTRAINT "course_form_records_anonymized_by_person_id_people_id_fkey" FOREIGN KEY ("anonymized_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_form_requirements" ADD CONSTRAINT "course_form_requirements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_form_requirements" ADD CONSTRAINT "course_form_requirements_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "course_form_requirements" ADD CONSTRAINT "course_form_requirements_form_id_course_forms_id_fkey" FOREIGN KEY ("form_id") REFERENCES "course_forms"("id");--> statement-breakpoint
ALTER TABLE "course_form_versions" ADD CONSTRAINT "course_form_versions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "course_form_versions" ADD CONSTRAINT "course_form_versions_form_id_course_forms_id_fkey" FOREIGN KEY ("form_id") REFERENCES "course_forms"("id");--> statement-breakpoint
ALTER TABLE "course_form_versions" ADD CONSTRAINT "course_form_versions_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "course_forms" ADD CONSTRAINT "course_forms_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");