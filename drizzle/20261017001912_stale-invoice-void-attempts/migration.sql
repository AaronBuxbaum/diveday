ALTER TABLE "orders" ADD COLUMN "auto_void_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "auto_void_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_auto_void_failures_nonnegative" CHECK ("auto_void_failures" >= 0);