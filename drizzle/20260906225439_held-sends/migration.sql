CREATE TYPE "held_send_kind" AS ENUM('waiver_send', 'last_minute_deal', 'waitlist_invite');--> statement-breakpoint
CREATE TABLE "held_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "held_send_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_person_id" uuid,
	"run_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "held_sends_run_at_idx" ON "held_sends" ("run_at");--> statement-breakpoint
ALTER TABLE "held_sends" ADD CONSTRAINT "held_sends_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "held_sends" ADD CONSTRAINT "held_sends_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id") ON DELETE SET NULL;