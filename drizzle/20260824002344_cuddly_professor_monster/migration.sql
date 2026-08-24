ALTER TYPE "order_status" ADD VALUE 'partly_refunded' BEFORE 'refunded';--> statement-breakpoint
ALTER TYPE "payment_status" ADD VALUE 'partly_refunded' BEFORE 'refunded';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_refunded_nonnegative" CHECK ("refunded_cents" >= 0);