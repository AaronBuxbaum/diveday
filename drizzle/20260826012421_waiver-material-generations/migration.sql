CREATE TABLE "waiver_materiality_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"material" boolean NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial
);
--> statement-breakpoint
ALTER TABLE "waiver_records" ADD COLUMN "template_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "waiver_templates" ADD COLUMN "material_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "waiver_materiality_decisions_shop_idx" ON "waiver_materiality_decisions" ("shop_id","template_id");--> statement-breakpoint
ALTER TABLE "waiver_materiality_decisions" ADD CONSTRAINT "waiver_materiality_decisions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "waiver_materiality_decisions" ADD CONSTRAINT "waiver_materiality_decisions_HD5Bu9IuOEoC_fkey" FOREIGN KEY ("template_id") REFERENCES "waiver_templates"("id");--> statement-breakpoint
ALTER TABLE "waiver_materiality_decisions" ADD CONSTRAINT "waiver_materiality_decisions_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");