CREATE TYPE "public"."waiver_status" AS ENUM('pending', 'signed', 'physician_required');--> statement-breakpoint
CREATE TABLE "waiver_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"requires_medical" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"token" text NOT NULL,
	"status" "waiver_status" DEFAULT 'pending' NOT NULL,
	"signed_name" text,
	"signed_at" timestamp with time zone,
	"medical_flagged" boolean DEFAULT false NOT NULL,
	"medical_notes" text,
	"physician_cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_template_id_waiver_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."waiver_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waiver_templates_shop_idx" ON "waiver_templates" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waivers_token_unique" ON "waivers" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "waivers_booking_unique" ON "waivers" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "waivers_shop_idx" ON "waivers" USING btree ("shop_id");