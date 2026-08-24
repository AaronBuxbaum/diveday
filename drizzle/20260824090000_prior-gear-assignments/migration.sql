CREATE TABLE IF NOT EXISTS "prior_gear_assignments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,"shop_id" uuid NOT NULL,"person_id" uuid NOT NULL,"gear_item_id" uuid NOT NULL,"assigned_from" date NOT NULL,"assigned_until" date NOT NULL,"status_label" text,"source_reference" text,"note" text,"dedupe_key" text NOT NULL,"imported_at" timestamp with time zone NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,CONSTRAINT "prior_gear_assignments_window" CHECK ("assigned_until" >= "assigned_from"));
--> statement-breakpoint
ALTER TABLE "prior_gear_assignments" ADD CONSTRAINT "prior_gear_assignments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id");
--> statement-breakpoint
ALTER TABLE "prior_gear_assignments" ADD CONSTRAINT "prior_gear_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id");
--> statement-breakpoint
ALTER TABLE "prior_gear_assignments" ADD CONSTRAINT "prior_gear_assignments_gear_item_id_gear_items_id_fk" FOREIGN KEY ("gear_item_id") REFERENCES "public"."gear_items"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prior_gear_assignments_shop_gear_idx" ON "prior_gear_assignments" ("shop_id","gear_item_id","assigned_from");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prior_gear_assignments_shop_person_idx" ON "prior_gear_assignments" ("shop_id","person_id","assigned_from");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prior_gear_assignments_shop_dedupe_unique" ON "prior_gear_assignments" ("shop_id","person_id","gear_item_id","dedupe_key");
