CREATE TYPE "stripe_subscription_status" AS ENUM('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused');--> statement-breakpoint
CREATE TABLE "shop_subscriptions" (
	"shop_id" uuid PRIMARY KEY,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_status" "stripe_subscription_status",
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"last_subscription_event_at" timestamp with time zone,
	"stripe_checkout_session_id" text,
	"free_term_ends_on" date,
	"first_paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shop_subscriptions_stripe_customer_unique" ON "shop_subscriptions" ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_subscriptions_stripe_subscription_unique" ON "shop_subscriptions" ("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "shop_subscriptions" ADD CONSTRAINT "shop_subscriptions_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");