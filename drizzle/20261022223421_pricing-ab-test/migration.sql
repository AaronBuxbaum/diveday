CREATE TYPE "pricing_plan" AS ENUM('flat_monthly', 'percent_of_volume');--> statement-breakpoint
CREATE TYPE "pricing_plan_source" AS ENUM('assigned', 'override');--> statement-breakpoint
CREATE TABLE "pricing_volume_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"month" date NOT NULL,
	"volume_cents" integer NOT NULL,
	"basis_points" integer NOT NULL,
	"fee_cents" integer NOT NULL,
	"stripe_meter_identifier" text NOT NULL,
	"reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_volume_statements_fee_check" CHECK ("fee_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD COLUMN "pricing_plan" "pricing_plan";--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD COLUMN "pricing_plan_source" "pricing_plan_source";--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD COLUMN "pricing_plan_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD COLUMN "assigned_pricing_plan" "pricing_plan";--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD COLUMN "plan_monthly_cents" integer;--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD COLUMN "plan_basis_points" integer;--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD COLUMN "paid_total_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "setup_requests" ADD COLUMN "pricing_plan" "pricing_plan";--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_volume_statements_shop_month_unique" ON "pricing_volume_statements" ("shop_id","month");--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD CONSTRAINT "pricing_volume_statements_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD CONSTRAINT "shop_subscriptions_pricing_plan_source_check" CHECK (("pricing_plan" is null) = ("pricing_plan_source" is null));--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD CONSTRAINT "shop_subscriptions_plan_numbers_check" CHECK (("plan_monthly_cents" is null or "plan_monthly_cents" between 0 and 100000) and ("plan_basis_points" is null or "plan_basis_points" between 0 and 1000));