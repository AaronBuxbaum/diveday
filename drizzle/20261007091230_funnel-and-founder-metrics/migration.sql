CREATE TYPE "shop_milestone" AS ENUM('shop_created', 'first_departure', 'first_public_booking', 'first_signed_waiver', 'first_roll_call', 'first_paid_month');--> statement-breakpoint
CREATE TABLE "demo_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source" text NOT NULL,
	"role" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_name" text NOT NULL,
	"region" text NOT NULL,
	"runs_boat" boolean NOT NULL,
	"current_system" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"source" text NOT NULL,
	"locale" text NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_milestones" (
	"shop_id" uuid,
	"milestone" "shop_milestone",
	"reached_at" timestamp with time zone NOT NULL,
	"stall_alerted_at" timestamp with time zone,
	CONSTRAINT "shop_milestones_pkey" PRIMARY KEY("shop_id","milestone")
);
--> statement-breakpoint
CREATE INDEX "demo_entries_entered_idx" ON "demo_entries" ("entered_at");--> statement-breakpoint
CREATE INDEX "setup_requests_created_idx" ON "setup_requests" ("created_at");--> statement-breakpoint
ALTER TABLE "shop_milestones" ADD CONSTRAINT "shop_milestones_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE;