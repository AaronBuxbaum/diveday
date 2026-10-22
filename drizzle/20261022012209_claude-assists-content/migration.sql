CREATE TABLE "assist_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"subject_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"input_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_text_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"field" text NOT NULL,
	"locale" text NOT NULL,
	"text" text,
	"source_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_text_translations_kind" CHECK ("subject_kind" in ('trip', 'course', 'dive_site'))
);
--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "recap_assist_auto_approve" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assist_results_subject_unique" ON "assist_results" ("shop_id","feature","subject_key");--> statement-breakpoint
CREATE INDEX "assist_results_updated_at_idx" ON "assist_results" ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_text_translations_subject_unique" ON "shop_text_translations" ("shop_id","subject_kind","subject_id","field","locale");--> statement-breakpoint
ALTER TABLE "assist_results" ADD CONSTRAINT "assist_results_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "shop_text_translations" ADD CONSTRAINT "shop_text_translations_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;