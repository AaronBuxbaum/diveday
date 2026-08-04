CREATE TABLE "day_closeouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"shop_day" text NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outstanding" jsonb NOT NULL,
	"seq" bigserial,
	CONSTRAINT "day_closeouts_shop_day_format" CHECK ("shop_day" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE INDEX "day_closeouts_shop_day_idx" ON "day_closeouts" ("shop_id","shop_day");--> statement-breakpoint
ALTER TABLE "day_closeouts" ADD CONSTRAINT "day_closeouts_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "day_closeouts" ADD CONSTRAINT "day_closeouts_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");