ALTER TYPE "order_collection" ADD VALUE 'bank_transfer' BEFORE 'room_charge';--> statement-breakpoint
ALTER TYPE "order_collection" ADD VALUE 'other' BEFORE 'room_charge';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tip_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "counter_receipt" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tip_bounds" CHECK ("tip_cents" >= 0 and "tip_cents" <= "amount_paid_cents");