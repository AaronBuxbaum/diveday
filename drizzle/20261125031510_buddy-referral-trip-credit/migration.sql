ALTER TABLE "shops" ADD COLUMN "buddy_credit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_credit_entries_referral_once" ON "trip_credit_entries" ("shop_id","booking_id") WHERE "reason" = 'referral';--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_buddy_credit_cents_range" CHECK ("buddy_credit_cents" between 0 and 1000000);--> statement-breakpoint
-- diveday:allow-destructive drop-constraint trip_credit_entries.trip_credit_entries_shape: re-added in the same statement with one more allowed shape (referral grants), so every existing row still passes and the previous release writes only shapes it keeps
ALTER TABLE "trip_credit_entries" DROP CONSTRAINT "trip_credit_entries_shape", ADD CONSTRAINT "trip_credit_entries_shape" CHECK ((
    ("kind" = 'grant' and "reason" is not null and "reason" in ('goodwill', 'promotion') and "booking_id" is null and "restores_entry_id" is null and "actor_person_id" is not null)
    or ("kind" = 'grant' and "reason" is not null and "reason" = 'referral' and "booking_id" is not null and "restores_entry_id" is null and "actor_person_id" is null)
    or ("kind" = 'redeem' and "reason" is null and "booking_id" is not null and "restores_entry_id" is null and "actor_person_id" is not null)
    or ("kind" = 'restore' and "reason" is null and "booking_id" is not null and "restores_entry_id" is not null)
  ));