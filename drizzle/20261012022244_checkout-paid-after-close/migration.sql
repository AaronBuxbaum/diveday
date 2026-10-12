ALTER TABLE "booking_checkouts" ADD COLUMN "paid_after_close_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "paid_after_close_cents" integer;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_paid_after_close_pair" CHECK (("paid_after_close_at" is null) = ("paid_after_close_cents" is null));--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_paid_after_close_nonnegative" CHECK ("paid_after_close_cents" is null or "paid_after_close_cents" >= 0);