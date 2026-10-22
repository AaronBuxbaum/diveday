CREATE TYPE "interest_asked_by" AS ENUM('diver', 'shop');--> statement-breakpoint
CREATE TYPE "interest_closed_as" AS ENUM('booked', 'done', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "interest_experience" AS ENUM('never', 'tried', 'certified', 'lapsed');--> statement-breakpoint
CREATE TYPE "interest_scope" AS ENUM('departure', 'date', 'anytime');--> statement-breakpoint
ALTER TYPE "held_send_kind" ADD VALUE 'seat_offer';--> statement-breakpoint
CREATE TABLE "interest_unsubscribe_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"interest_id" uuid NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"scope" "interest_scope" NOT NULL,
	"asked_by" "interest_asked_by" NOT NULL,
	"parent_interest_id" uuid,
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
	"experience_level" "interest_experience",
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
	"closed_as" "interest_closed_as",
	CONSTRAINT "interests_scope_columns" CHECK ((
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
	CONSTRAINT "interests_has_a_person" CHECK ("scope" = 'date' or "person_id" is not null or "parent_interest_id" is not null),
	CONSTRAINT "interests_offer_is_a_departure" CHECK ("scope" = 'departure' or ("offered_at" is null and "promo_id" is null)),
	CONSTRAINT "interests_emailed_after_offer" CHECK ("emailed_at" is null or "offered_at" is not null),
	CONSTRAINT "interests_closed_together" CHECK (("closed_at" is null) = ("closed_as" is null)),
	CONSTRAINT "interests_party_size_range" CHECK (("party_size" is not null or "scope" <> 'departure') and ("party_size" is null or "party_size" between 1 and 20))
);
--> statement-breakpoint
CREATE INDEX "interest_unsubscribe_tokens_token_hash_idx" ON "interest_unsubscribe_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "interest_unsubscribe_tokens_interest_idx" ON "interest_unsubscribe_tokens" ("interest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interests_departure_person_unique" ON "interests" ("trip_id","person_id") WHERE "scope" = 'departure' and "person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "interests_departure_parent_unique" ON "interests" ("trip_id","parent_interest_id") WHERE "scope" = 'departure' and "parent_interest_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "interests_anytime_shop_person_unique" ON "interests" ("shop_id","person_id") WHERE "scope" = 'anytime';--> statement-breakpoint
CREATE INDEX "interests_departure_idx" ON "interests" ("shop_id","trip_id","asked_at") WHERE "scope" = 'departure';--> statement-breakpoint
CREATE INDEX "interests_date_preferred_idx" ON "interests" ("shop_id","preferred_date") WHERE "scope" = 'date' and "closed_at" is null;--> statement-breakpoint
CREATE INDEX "interests_date_alternate_idx" ON "interests" ("shop_id","alternate_date") WHERE "scope" = 'date' and "closed_at" is null;--> statement-breakpoint
CREATE INDEX "interests_anytime_open_idx" ON "interests" ("shop_id") WHERE "scope" = 'anytime' and "closed_at" is null;--> statement-breakpoint
CREATE INDEX "interests_person_idx" ON "interests" ("person_id");--> statement-breakpoint
CREATE INDEX "interests_created_by_person_idx" ON "interests" ("created_by_person_id");--> statement-breakpoint
CREATE INDEX "interests_parent_idx" ON "interests" ("parent_interest_id");--> statement-breakpoint
CREATE INDEX "interests_course_idx" ON "interests" ("course_id");--> statement-breakpoint
CREATE INDEX "interests_promo_idx" ON "interests" ("promo_id");--> statement-breakpoint
CREATE INDEX "interests_shop_asked_idx" ON "interests" ("shop_id","asked_at");--> statement-breakpoint
ALTER TABLE "interest_unsubscribe_tokens" ADD CONSTRAINT "interest_unsubscribe_tokens_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "interest_unsubscribe_tokens" ADD CONSTRAINT "interest_unsubscribe_tokens_interest_id_interests_id_fkey" FOREIGN KEY ("interest_id") REFERENCES "interests"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_parent_interest_id_interests_id_fkey" FOREIGN KEY ("parent_interest_id") REFERENCES "interests"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_trip_id_trips_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_course_id_courses_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_created_by_person_id_people_id_fkey" FOREIGN KEY ("created_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "interests" ADD CONSTRAINT "interests_promo_id_trip_last_minute_promos_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "trip_last_minute_promos"("id");