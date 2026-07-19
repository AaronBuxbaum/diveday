ALTER TABLE "courses" ADD COLUMN "agency" text DEFAULT 'padi' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "e_learning_price_cents" integer;