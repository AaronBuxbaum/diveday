CREATE TYPE "public"."waiver_record_status" AS ENUM('pending', 'completed', 'medical_review');--> statement-breakpoint
CREATE TABLE "waiver_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"template_title" text NOT NULL,
	"template_version" integer NOT NULL,
	"template_body" text NOT NULL,
	"status" "waiver_record_status" DEFAULT 'pending' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"draft_signer_name" text,
	"draft_acknowledged" boolean DEFAULT false NOT NULL,
	"draft_medical_answers" jsonb,
	"signed_name" text,
	"signature_method" text,
	"consented_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"medical_answers" jsonb,
	"medical_review_required" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waiver_records_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "waiver_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_records" ADD CONSTRAINT "waiver_records_template_id_waiver_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."waiver_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waiver_records_booking_current_idx" ON "waiver_records" USING btree ("booking_id","superseded_at");--> statement-breakpoint
CREATE INDEX "waiver_records_shop_status_idx" ON "waiver_records" USING btree ("shop_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_templates_shop_title_version_unique" ON "waiver_templates" USING btree ("shop_id","title","version");--> statement-breakpoint
CREATE INDEX "waiver_templates_shop_default_idx" ON "waiver_templates" USING btree ("shop_id","is_default");