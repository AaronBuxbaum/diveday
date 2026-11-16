ALTER TYPE "payment_event_operation" ADD VALUE 'trip_credit_redeemed' BEFORE 'order_refunded';--> statement-breakpoint
ALTER TYPE "payment_event_operation" ADD VALUE 'trip_credit_released' BEFORE 'order_refunded';--> statement-breakpoint
ALTER TYPE "payment_event_operation" ADD VALUE 'trip_credit_reopened' BEFORE 'order_refunded';--> statement-breakpoint
CREATE TABLE "trip_credit_entries" (
	"id" uuid PRIMARY KEY,
	"shop_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"booking_id" uuid,
	"restores_entry_id" uuid,
	"actor_person_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial,
	CONSTRAINT "trip_credit_entries_amount_positive" CHECK ("amount_cents" > 0),
	CONSTRAINT "trip_credit_entries_currency" CHECK ("currency" ~ '^[a-z]{3}$'),
	CONSTRAINT "trip_credit_entries_shape" CHECK ((
    ("kind" = 'grant' and "reason" is not null and "reason" in ('goodwill', 'promotion') and "booking_id" is null and "restores_entry_id" is null and "actor_person_id" is not null)
    or ("kind" = 'redeem' and "reason" is null and "booking_id" is not null and "restores_entry_id" is null and "actor_person_id" is not null)
    or ("kind" = 'restore' and "reason" is null and "booking_id" is not null and "restores_entry_id" is not null)
  ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trip_credit_entries_scoped_id_unique" ON "trip_credit_entries" ("shop_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_credit_entries_restore_once" ON "trip_credit_entries" ("restores_entry_id");--> statement-breakpoint
CREATE INDEX "trip_credit_entries_balance_idx" ON "trip_credit_entries" ("shop_id","person_id","currency","seq");--> statement-breakpoint
CREATE INDEX "trip_credit_entries_booking_idx" ON "trip_credit_entries" ("shop_id","booking_id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_shop_id_shops_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_person_id_people_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_booking_id_bookings_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_tOnrmHxTsTxG_fkey" FOREIGN KEY ("restores_entry_id") REFERENCES "trip_credit_entries"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_actor_person_id_people_id_fkey" FOREIGN KEY ("actor_person_id") REFERENCES "people"("id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_booking_shop_fk" FOREIGN KEY ("shop_id","booking_id") REFERENCES "bookings"("shop_id","id");--> statement-breakpoint
ALTER TABLE "trip_credit_entries" ADD CONSTRAINT "trip_credit_entries_restore_shop_fk" FOREIGN KEY ("shop_id","restores_entry_id") REFERENCES "trip_credit_entries"("shop_id","id");