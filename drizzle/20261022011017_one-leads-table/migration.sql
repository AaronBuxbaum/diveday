CREATE TYPE "lead_asked_by" AS ENUM('diver', 'shop');--> statement-breakpoint
CREATE TYPE "lead_closed_as" AS ENUM('booked', 'done', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "lead_experience" AS ENUM('never', 'tried', 'certified', 'lapsed');--> statement-breakpoint
CREATE TYPE "lead_scope" AS ENUM('departure', 'date', 'anytime');--> statement-breakpoint
ALTER TYPE "held_send_kind" ADD VALUE 'seat_offer';--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"scope" "lead_scope" NOT NULL,
	"asked_by" "lead_asked_by" NOT NULL,
	"parent_lead_id" uuid,
	"person_id" uuid,
	"name" text,
	"email" text,
	"phone" text,
	"trip_id" uuid,
	"course_id" uuid,
	"interest" text,
	"preferred_date" date,
	"alternate_date" date,
	"date_flexible" boolean DEFAULT false NOT NULL,
	"experience_level" "lead_experience",
	"timing" text,
	"message" text,
	"available_from" date,
	"available_until" date,
	"party_size" integer,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_person_id" uuid,
	"offered_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"promo_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_as" "lead_closed_as",
	CONSTRAINT "leads_scope_columns" CHECK ((
        ("scope" = 'departure'
          and "trip_id" is not null
          and "course_id" is null
          and "interest" is null
          and "preferred_date" is null
          and "alternate_date" is null
          and "date_flexible" = false
          and "experience_level" is null
          and "timing" is null
          and "message" is null
          and "available_from" is null
          and "available_until" is null)
        or ("scope" = 'date'
          and "trip_id" is null
          and ("course_id" is not null or length(btrim(coalesce("interest", ''))) > 0)
          and "available_from" is null
          and "available_until" is null)
        or ("scope" = 'anytime'
          and "trip_id" is null
          and "course_id" is null
          and "interest" is null
          and "preferred_date" is null
          and "alternate_date" is null
          and "date_flexible" = false
          and "experience_level" is null
          and "timing" is null
          and "message" is null
          and ("available_from" is null
            or "available_until" is null
            or "available_from" <= "available_until"))
      )),
	CONSTRAINT "leads_has_a_person" CHECK ("scope" = 'date' or "person_id" is not null or "parent_lead_id" is not null),
	CONSTRAINT "leads_offer_is_a_departure" CHECK ("scope" = 'departure' or ("offered_at" is null and "promo_id" is null)),
	CONSTRAINT "leads_emailed_after_offer" CHECK ("emailed_at" is null or "offered_at" is not null),
	CONSTRAINT "leads_closed_together" CHECK (("closed_at" is null) = ("closed_as" is null)),
	CONSTRAINT "leads_party_size_range" CHECK (("party_size" is not null or "scope" <> 'departure') and ("party_size" is null or "party_size" between 1 and 20))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "leads_departure_person_unique" ON "leads" ("trip_id","person_id") WHERE "scope" = 'departure' and "person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_departure_parent_unique" ON "leads" ("trip_id","parent_lead_id") WHERE "scope" = 'departure' and "parent_lead_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_anytime_shop_person_unique" ON "leads" ("shop_id","person_id") WHERE "scope" = 'anytime';--> statement-breakpoint
CREATE INDEX "leads_departure_idx" ON "leads" ("shop_id","trip_id","asked_at") WHERE "scope" = 'departure';--> statement-breakpoint
CREATE INDEX "leads_date_preferred_idx" ON "leads" ("shop_id","preferred_date") WHERE "scope" = 'date' and "closed_at" is null;--> statement-breakpoint
CREATE INDEX "leads_date_alternate_idx" ON "leads" ("shop_id","alternate_date") WHERE "scope" = 'date' and "closed_at" is null;--> statement-breakpoint
CREATE INDEX "leads_anytime_open_idx" ON "leads" ("shop_id") WHERE "scope" = 'anytime' and "closed_at" is null;--> statement-breakpoint
CREATE INDEX "leads_person_idx" ON "leads" ("person_id");--> statement-breakpoint
CREATE INDEX "leads_created_by_person_idx" ON "leads" ("created_by_person_id");--> statement-breakpoint
CREATE INDEX "leads_parent_idx" ON "leads" ("parent_lead_id");--> statement-breakpoint
CREATE INDEX "leads_course_idx" ON "leads" ("course_id");--> statement-breakpoint
CREATE INDEX "leads_promo_idx" ON "leads" ("promo_id");--> statement-breakpoint
CREATE INDEX "leads_shop_asked_idx" ON "leads" ("shop_id","asked_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_parent_lead_id_leads_id_fkey" FOREIGN KEY ("parent_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_promo_id_trip_last_minute_promos_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "trip_last_minute_promos"("id");