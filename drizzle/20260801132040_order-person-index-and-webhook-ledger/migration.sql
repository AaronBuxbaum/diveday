CREATE TABLE "stripe_webhook_events" (
	"id" text PRIMARY KEY,
	"type" text NOT NULL,
	"account" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bookings_shop_person_idx" ON "bookings" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "orders_shop_person_idx" ON "orders" ("shop_id","person_id");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_account_type_idx" ON "stripe_webhook_events" ("account","type","occurred_at");