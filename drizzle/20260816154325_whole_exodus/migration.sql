CREATE TYPE "imported_payment_direction" AS ENUM('payment', 'refund', 'unknown');--> statement-breakpoint
CREATE TABLE "imported_payment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"direction" "imported_payment_direction" DEFAULT 'unknown'::"imported_payment_direction" NOT NULL,
	"title" text,
	"status_label" text,
	"amount_label" text,
	"amount_cents" integer,
	"currency" text,
	"payment_reference" text,
	"receipt_reference" text,
	"receipt_document_url" text,
	"source_label" text,
	"source_reference" text,
	"stripe_reference" text,
	"dedupe_key" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imported_payment_history_amount_nonnegative" CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0),
	CONSTRAINT "imported_payment_history_amount_currency_pair" CHECK (("amount_cents" IS NULL AND "currency" IS NULL) OR ("amount_cents" IS NOT NULL AND "currency" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "imported_payment_history_shop_person_idx" ON "imported_payment_history" ("shop_id","person_id","occurred_on");--> statement-breakpoint
CREATE INDEX "imported_payment_history_shop_date_idx" ON "imported_payment_history" ("shop_id","occurred_on");--> statement-breakpoint
CREATE INDEX "imported_payment_history_shop_currency_direction_idx" ON "imported_payment_history" ("shop_id","currency","direction","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_payment_history_shop_person_dedupe_unique" ON "imported_payment_history" ("shop_id","person_id","dedupe_key");--> statement-breakpoint
ALTER TABLE "imported_payment_history" ADD CONSTRAINT "imported_payment_history_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "imported_payment_history" ADD CONSTRAINT "imported_payment_history_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");