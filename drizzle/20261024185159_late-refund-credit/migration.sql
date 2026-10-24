ALTER TABLE "pricing_volume_statements" ADD COLUMN "month_card_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD COLUMN "late_refund_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD COLUMN "refund_carry_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD COLUMN "refunded_since_close_cents" integer DEFAULT 0 NOT NULL;