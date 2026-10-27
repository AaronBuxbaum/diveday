CREATE TABLE "certification_junior_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"certification_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"recorded_by_person_id" uuid NOT NULL,
	"junior_status" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certification_junior_reviews_status_valid" CHECK ("junior_status" in ('junior', 'full'))
);
--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "junior_status" text;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "junior_status_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "junior_status_verified_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "require_adult_buddy_for_teens" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "certification_junior_reviews_person_idx" ON "certification_junior_reviews" ("person_id");--> statement-breakpoint
CREATE INDEX "certification_junior_reviews_recorder_idx" ON "certification_junior_reviews" ("recorded_by_person_id");--> statement-breakpoint
CREATE INDEX "certification_junior_reviews_card_idx" ON "certification_junior_reviews" ("shop_id","certification_id","recorded_at");--> statement-breakpoint
CREATE INDEX "certifications_junior_status_verifier_idx" ON "certifications" ("junior_status_verified_by_person_id");--> statement-breakpoint
ALTER TABLE "certification_junior_reviews" ADD CONSTRAINT "certification_junior_reviews_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "certification_junior_reviews" ADD CONSTRAINT "certification_junior_reviews_fhxDHj1bkYkh_fkey" FOREIGN KEY ("certification_id") REFERENCES "certifications"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "certification_junior_reviews" ADD CONSTRAINT "certification_junior_reviews_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certification_junior_reviews" ADD CONSTRAINT "certification_junior_reviews_XBkZaqg9nyJ5_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_uFx0uU65dfWX_fkey" FOREIGN KEY ("junior_status_verified_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_junior_status_valid" CHECK ("junior_status" is null or "junior_status" in ('junior', 'full'));--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_junior_status_evidence" CHECK (("junior_status" is null and "junior_status_verified_at" is null and "junior_status_verified_by_person_id" is null) or ("junior_status" is not null and "junior_status_verified_at" is not null and "junior_status_verified_by_person_id" is not null));