ALTER TABLE "booking_checkouts" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "booking_payments" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tips" ALTER COLUMN "currency" DROP DEFAULT;