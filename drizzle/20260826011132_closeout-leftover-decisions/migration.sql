CREATE TABLE "closeout_leftover_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"shop_day" text NOT NULL,
	"action_id" text NOT NULL,
	"decision" text NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "closeout_leftover_decisions_shop_day_format" CHECK ("shop_day" ~ '^\d{4}-\d{2}-\d{2}$'),
	CONSTRAINT "closeout_leftover_decisions_value" CHECK ("decision" in ('carry', 'dismiss')),
	CONSTRAINT "closeout_leftover_decisions_action_id_nonempty" CHECK (length("action_id") > 0)
);
--> statement-breakpoint
CREATE INDEX "closeout_leftover_decisions_shop_day_idx" ON "closeout_leftover_decisions" ("shop_id","shop_day");--> statement-breakpoint
CREATE INDEX "closeout_leftover_decisions_action_idx" ON "closeout_leftover_decisions" ("shop_id","shop_day","action_id","seq");--> statement-breakpoint
ALTER TABLE "closeout_leftover_decisions" ADD CONSTRAINT "closeout_leftover_decisions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "closeout_leftover_decisions" ADD CONSTRAINT "closeout_leftover_decisions_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");