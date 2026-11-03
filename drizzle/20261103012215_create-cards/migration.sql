CREATE TYPE "card_kind" AS ENUM('level', 'specialty', 'nitrox');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "card_kind" NOT NULL,
	"agency" "certification_agency" NOT NULL,
	"level" "certification_level",
	"specialty" "dive_specialty",
	"identifier" text,
	"declared_identifier" text,
	"status" "certification_status" DEFAULT 'pending'::"certification_status" NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_person_id" uuid,
	"agency_checked_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"imported_from_label" text,
	"self_declared_at" timestamp with time zone,
	"issued_by_shop_at" timestamp with time zone,
	"issued_from_trip_id" uuid,
	"issued_by_person_id" uuid,
	"processed_with_agency_at" timestamp with time zone,
	"processed_by_person_id" uuid,
	"listed_from_certification_id" uuid,
	"junior_status" text,
	"junior_status_verified_at" timestamp with time zone,
	"junior_status_verified_by_person_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_kind_shape" CHECK (("kind" = 'level' and "level" is not null and "specialty" is null) or ("kind" = 'specialty' and "specialty" is not null and "level" is null) or ("kind" = 'nitrox' and "level" is null and "specialty" is null)),
	CONSTRAINT "cards_declared_identifier_level_only" CHECK ("declared_identifier" is null or "kind" = 'level'),
	CONSTRAINT "cards_listed_from_not_level" CHECK ("listed_from_certification_id" is null or "kind" <> 'level'),
	CONSTRAINT "cards_junior_status_level_only" CHECK ("junior_status" is null or "kind" = 'level'),
	CONSTRAINT "cards_junior_status_valid" CHECK ("junior_status" is null or "junior_status" in ('junior', 'full')),
	CONSTRAINT "cards_junior_status_evidence" CHECK (("junior_status" is null and "junior_status_verified_at" is null and "junior_status_verified_by_person_id" is null) or ("junior_status" is not null and "junior_status_verified_at" is not null and "junior_status_verified_by_person_id" is not null)),
	CONSTRAINT "cards_processed_only_when_issued" CHECK ("processed_with_agency_at" is null or "issued_by_shop_at" is not null),
	CONSTRAINT "cards_identifier_present_unless_unsighted" CHECK (("identifier" is not null and length(btrim("identifier", E' \t\n\r\f\v')) > 0) or ("self_declared_at" is not null and "status" = 'pending') or ("issued_by_shop_at" is not null and ("kind" = 'level' or "status" = 'pending')) or ("listed_from_certification_id" is not null and "kind" <> 'level' and "status" = 'pending'))
);
--> statement-breakpoint
CREATE INDEX "cards_person_id_idx" ON "cards" ("person_id");--> statement-breakpoint
CREATE INDEX "cards_shop_person_kind_idx" ON "cards" ("shop_id","person_id","kind");--> statement-breakpoint
CREATE INDEX "cards_junior_status_verifier_idx" ON "cards" ("junior_status_verified_by_person_id");--> statement-breakpoint
CREATE INDEX "cards_processed_by_person_idx" ON "cards" ("processed_by_person_id") WHERE "processed_by_person_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_level_shop_agency_identifier_unique" ON "cards" ("shop_id","agency",lower("identifier")) WHERE "deleted_at" is null and "kind" = 'level';--> statement-breakpoint
CREATE UNIQUE INDEX "cards_specialty_shop_agency_specialty_identifier_unique" ON "cards" ("shop_id","agency","specialty",lower("identifier")) WHERE "deleted_at" is null and "kind" = 'specialty';--> statement-breakpoint
CREATE UNIQUE INDEX "cards_nitrox_shop_agency_identifier_unique" ON "cards" ("shop_id","agency",lower("identifier")) WHERE "deleted_at" is null and "kind" = 'nitrox';--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_reviewed_by_person_id_people_id_fkey" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_issued_from_trip_id_trips_id_fkey" FOREIGN KEY ("issued_from_trip_id") REFERENCES "trips"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_issued_by_person_id_people_id_fkey" FOREIGN KEY ("issued_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_processed_by_person_id_people_id_fkey" FOREIGN KEY ("processed_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_listed_from_certification_id_cards_id_fkey" FOREIGN KEY ("listed_from_certification_id") REFERENCES "cards"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_junior_status_verified_by_person_id_people_id_fkey" FOREIGN KEY ("junior_status_verified_by_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_deleted_by_person_id_people_id_fkey" FOREIGN KEY ("deleted_by_person_id") REFERENCES "people"("id");