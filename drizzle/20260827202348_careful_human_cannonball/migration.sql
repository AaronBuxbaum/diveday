CREATE TABLE "dive_support_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"support_divers_needed" integer,
	"needs_boarding_assistance" boolean DEFAULT false NOT NULL,
	"needs_water_entry_lift" boolean DEFAULT false NOT NULL,
	"briefing_in_sign" boolean DEFAULT false NOT NULL,
	"briefing_in_writing" boolean DEFAULT false NOT NULL,
	"briefing_by_signals" boolean DEFAULT false NOT NULL,
	"equipment_adaptation" text,
	"dives_with_name" text,
	"stated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dive_support_needs_support_divers_range" CHECK ("support_divers_needed" is null or ("support_divers_needed" between 0 and 4))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dive_support_needs_shop_person_unique" ON "dive_support_needs" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "dive_support_needs_shop_person_idx" ON "dive_support_needs" ("shop_id","person_id");--> statement-breakpoint
ALTER TABLE "dive_support_needs" ADD CONSTRAINT "dive_support_needs_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "dive_support_needs" ADD CONSTRAINT "dive_support_needs_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");