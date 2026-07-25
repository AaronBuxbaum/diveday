CREATE TABLE "prior_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"visited_on" date NOT NULL,
	"title" text,
	"status_label" text,
	"amount_label" text,
	"source_label" text,
	"source_reference" text,
	"dedupe_key" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "prior_visits_shop_person_idx" ON "prior_visits" ("shop_id","person_id","visited_on");--> statement-breakpoint
CREATE UNIQUE INDEX "prior_visits_shop_person_dedupe_unique" ON "prior_visits" ("shop_id","person_id","dedupe_key");--> statement-breakpoint
ALTER TABLE "prior_visits" ADD CONSTRAINT "prior_visits_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "prior_visits" ADD CONSTRAINT "prior_visits_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");