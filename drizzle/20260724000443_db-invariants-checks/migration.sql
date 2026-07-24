-- CR-017: nonnegative money, positive quantities, supported trip capacity/
-- planned-dive ranges, and a valid trip time range, enforced at the database
-- layer as a last-resort backstop behind the application-level validation
-- (CR-016). Each ADD CONSTRAINT is preceded by a preflight DO block that
-- counts existing violations and RAISEs a precise, actionable error instead
-- of letting Postgres's own generic constraint-violation error surface —
-- an owner or migration operator sees exactly which table and how many rows
-- need fixing before retrying.
DO $$
DECLARE bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM "booking_checkouts"
    WHERE NOT ("amount_per_diver_cents" >= 0 AND "total_cents" >= 0);
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'CR-017 preflight: % existing booking_checkouts row(s) violate the nonnegative-amount constraint; fix or void them before migrating', bad_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_amount_per_diver_nonnegative" CHECK ("amount_per_diver_cents" >= 0);--> statement-breakpoint
ALTER TABLE "booking_checkouts" ADD CONSTRAINT "booking_checkouts_total_nonnegative" CHECK ("total_cents" >= 0);--> statement-breakpoint

DO $$
DECLARE bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM "booking_payments"
    WHERE NOT ("amount_cents" is null or "amount_cents" >= 0);
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'CR-017 preflight: % existing booking_payments row(s) have a negative amount_cents; fix them before migrating', bad_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_amount_nonnegative" CHECK ("amount_cents" is null or "amount_cents" >= 0);--> statement-breakpoint

DO $$
DECLARE bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM "order_line_items"
    WHERE NOT ("quantity" > 0 AND "unit_amount_cents" >= 0);
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'CR-017 preflight: % existing order_line_items row(s) violate the positive-quantity/nonnegative-amount constraint; fix them before migrating', bad_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_quantity_positive" CHECK ("quantity" > 0);--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_unit_amount_nonnegative" CHECK ("unit_amount_cents" >= 0);--> statement-breakpoint

DO $$
DECLARE bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM "orders"
    WHERE NOT ("total_cents" >= 0 AND "amount_paid_cents" >= 0);
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'CR-017 preflight: % existing orders row(s) violate the nonnegative-amount constraint; fix them before migrating', bad_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_nonnegative" CHECK ("total_cents" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_amount_paid_nonnegative" CHECK ("amount_paid_cents" >= 0);--> statement-breakpoint

DO $$
DECLARE bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM "shops"
    WHERE NOT ("dock_call_minutes" >= 0);
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'CR-017 preflight: % existing shops row(s) have a negative dock_call_minutes; fix them before migrating', bad_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_dock_call_minutes_nonnegative" CHECK ("dock_call_minutes" >= 0);--> statement-breakpoint

DO $$
DECLARE bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM "trips"
    WHERE NOT (
      "capacity" between 1 and 60
      AND "planned_dives" between 1 and 4
      AND ("price_cents" is null or "price_cents" >= 0)
      AND ("deposit_cents" is null or "deposit_cents" >= 0)
      AND ("cancellation_window_hours" is null or "cancellation_window_hours" >= 0)
      AND "ends_at" > "starts_at"
    );
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'CR-017 preflight: % existing trips row(s) violate a capacity/planned-dive/money/time-range invariant; fix them before migrating', bad_count;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_capacity_range" CHECK ("capacity" between 1 and 60);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_planned_dives_range" CHECK ("planned_dives" between 1 and 4);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_price_nonnegative" CHECK ("price_cents" is null or "price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_deposit_nonnegative" CHECK ("deposit_cents" is null or "deposit_cents" >= 0);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_cancellation_window_nonnegative" CHECK ("cancellation_window_hours" is null or "cancellation_window_hours" >= 0);--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_ends_after_starts" CHECK ("ends_at" > "starts_at");
