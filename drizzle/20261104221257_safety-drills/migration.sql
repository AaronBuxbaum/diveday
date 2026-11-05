CREATE TYPE "safety_drill_kind" AS ENUM('oxygen', 'missing_diver', 'overboard', 'fire');--> statement-breakpoint
CREATE TABLE "safety_drill_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"drill_id" uuid NOT NULL,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_drills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"kind" "safety_drill_kind" NOT NULL,
	"held_on" date NOT NULL,
	"note" text,
	"recorded_by_person_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "safety_drill_participants_drill_person_unique" ON "safety_drill_participants" ("drill_id","person_id");--> statement-breakpoint
CREATE INDEX "safety_drill_participants_person_id_idx" ON "safety_drill_participants" ("person_id");--> statement-breakpoint
CREATE INDEX "safety_drills_shop_held_live_idx" ON "safety_drills" ("shop_id","held_on") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "safety_drills_recorded_by_person_id_idx" ON "safety_drills" ("recorded_by_person_id");--> statement-breakpoint
ALTER TABLE "safety_drill_participants" ADD CONSTRAINT "safety_drill_participants_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "safety_drill_participants" ADD CONSTRAINT "safety_drill_participants_drill_id_safety_drills_id_fkey" FOREIGN KEY ("drill_id") REFERENCES "safety_drills"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "safety_drill_participants" ADD CONSTRAINT "safety_drill_participants_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "safety_drills" ADD CONSTRAINT "safety_drills_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "safety_drills" ADD CONSTRAINT "safety_drills_recorded_by_person_id_people_id_fkey" FOREIGN KEY ("recorded_by_person_id") REFERENCES "people"("id");