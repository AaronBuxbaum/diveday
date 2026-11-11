-- diveday:allow-destructive drop-column pricing_volume_statements.refund_carry_cents: replaced by native-currency fee credit accounting before the first customer; no compatibility data (H-20260815-no-legacy)
-- diveday:allow-destructive drop-column pricing_volume_statements.refunded_since_close_cents: replaced by immutable statement credits before the first customer; no compatibility data (H-20260815-no-legacy)
CREATE TABLE "collection_entries" (
	"id" bigserial PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reverses_entry_id" bigint,
	"evidence" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_entries_source_check" CHECK ("source_type" in ('order', 'checkout', 'booking')),
	CONSTRAINT "collection_entries_currency_check" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "collection_entries_reversal_check" CHECK ("amount_cents" <> 0 and ("amount_cents" > 0 or "reverses_entry_id" is not null))
);
--> statement-breakpoint
DROP VIEW "booking_payments";--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD COLUMN "currency" text DEFAULT 'usd' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD COLUMN "collections" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD COLUMN "gross_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD COLUMN "refund_credit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD COLUMN "fee_credit_carry_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" ADD COLUMN "credits" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD COLUMN "collection_needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD COLUMN "manual_held_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" DROP COLUMN "refund_carry_cents";--> statement-breakpoint
ALTER TABLE "pricing_volume_statements" DROP COLUMN "refunded_since_close_cents";--> statement-breakpoint
DROP INDEX "pricing_volume_statements_shop_month_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_volume_statements_shop_month_unique" ON "pricing_volume_statements" ("shop_id","month","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_entries_shop_id_unique" ON "collection_entries" ("shop_id","id");--> statement-breakpoint
CREATE INDEX "collection_entries_source_idx" ON "collection_entries" ("shop_id","source_type","source_id","id");--> statement-breakpoint
CREATE INDEX "collection_entries_month_idx" ON "collection_entries" ("shop_id","recorded_at");--> statement-breakpoint
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_reversal_shop_fk" FOREIGN KEY ("shop_id","reverses_entry_id") REFERENCES "collection_entries"("shop_id","id");--> statement-breakpoint
ALTER TABLE "booking_payment_events" ADD CONSTRAINT "booking_payment_events_manual_held_check" CHECK ("manual_held_cents" >= 0 and ("amount_cents" is null or "manual_held_cents" <= "amount_cents"));--> statement-breakpoint
CREATE VIEW "booking_payments" AS (select distinct on (shop_id, booking_id) id, shop_id, booking_id, status, amount_cents, currency, provider, provider_ref, note, method, recorded_by_person_id, occurred_at as updated_at, created_at, manual_held_cents from booking_payment_events order by shop_id, booking_id, occurred_at desc, seq desc);