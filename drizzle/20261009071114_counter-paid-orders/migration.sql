CREATE TYPE "order_collection" AS ENUM('stripe_invoice', 'cash', 'card_machine');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "collection" "order_collection" DEFAULT 'stripe_invoice'::"order_collection" NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "stripe_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "stripe_customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "stripe_invoice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stripe_ids_match_collection" CHECK (("collection" = 'stripe_invoice' and "stripe_account_id" is not null and "stripe_customer_id" is not null and "stripe_invoice_id" is not null) or ("collection" <> 'stripe_invoice' and "stripe_account_id" is null and "stripe_customer_id" is null and "stripe_invoice_id" is null and "stripe_payment_intent_id" is null));