-- Expand/contract bridge for issue #2720 (ADR 20261103-a-deal-is-one-row). A shop-wide promo code
-- and a last-minute deal are now one `deals` row each, told apart by trip_id, and a checkout or a
-- payment intent names it by deal_id. Every row keeps its id, so a reference to an old row is a
-- reference to its deal. The release still serving while this migration runs writes the two retired
-- tables and the two retired columns; the triggers below forward those writes, so a code minted,
-- switched off or spent during the deploy is the same deal after it. A last-minute deal's `sent` is
-- a deal's `active`. The retired tables, columns, triggers and functions are dropped next release.
INSERT INTO "deals" ("id", "shop_id", "trip_id", "code", "description", "discount_percent", "discount_amount_cents", "scope", "status", "starts_at", "expires_at", "max_redemptions", "stripe_coupon_id", "stripe_promotion_code_id", "recipient_count", "created_by_person_id", "created_at")
SELECT "id", "shop_id", NULL, "code", "description", "discount_percent", "discount_amount_cents", "scope", "status"::text::"deal_status", "starts_at", "expires_at", "max_redemptions", "stripe_coupon_id", "stripe_promotion_code_id", 0, "created_by_person_id", "created_at"
FROM "shop_promo_codes"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "deals" ("id", "shop_id", "trip_id", "code", "discount_percent", "discount_amount_cents", "status", "expires_at", "max_redemptions", "stripe_coupon_id", "stripe_promotion_code_id", "recipient_count", "created_by_person_id", "created_at")
SELECT "id", "shop_id", "trip_id", "code", "discount_percent", "discount_amount_cents", CASE "status" WHEN 'sent' THEN 'active'::"deal_status" WHEN 'failed' THEN 'failed'::"deal_status" ELSE 'pending'::"deal_status" END, "expires_at", "max_redemptions", "stripe_coupon_id", "stripe_promotion_code_id", "recipient_count", "created_by_person_id", "created_at"
FROM "trip_last_minute_promos"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "booking_checkouts" SET "deal_id" = coalesce("promo_code_id", "trip_promo_id") WHERE "deal_id" IS NULL AND ("promo_code_id" IS NOT NULL OR "trip_promo_id" IS NOT NULL);--> statement-breakpoint
UPDATE "payment_operation_intents" SET "deal_id" = coalesce("promo_code_id", "trip_promo_id") WHERE "deal_id" IS NULL AND ("promo_code_id" IS NOT NULL OR "trip_promo_id" IS NOT NULL);--> statement-breakpoint
CREATE FUNCTION "forward_retired_shop_promo_codes"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "deals" WHERE "id" = OLD."id" AND "trip_id" IS NULL;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    UPDATE "deals" SET "status" = NEW."status"::text::"deal_status", "stripe_coupon_id" = NEW."stripe_coupon_id",
      "stripe_promotion_code_id" = NEW."stripe_promotion_code_id", "created_by_person_id" = NEW."created_by_person_id"
    WHERE "id" = NEW."id" AND "trip_id" IS NULL;
    RETURN NEW;
  END IF;
  INSERT INTO "deals" ("id", "shop_id", "trip_id", "code", "description", "discount_percent", "discount_amount_cents", "scope", "status", "starts_at", "expires_at", "max_redemptions", "stripe_coupon_id", "stripe_promotion_code_id", "recipient_count", "created_by_person_id", "created_at")
  VALUES (NEW."id", NEW."shop_id", NULL, NEW."code", NEW."description", NEW."discount_percent", NEW."discount_amount_cents", NEW."scope", NEW."status"::text::"deal_status", NEW."starts_at", NEW."expires_at", NEW."max_redemptions", NEW."stripe_coupon_id", NEW."stripe_promotion_code_id", 0, NEW."created_by_person_id", NEW."created_at")
  ON CONFLICT ("id") DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "forward_retired_shop_promo_codes" AFTER INSERT OR UPDATE OR DELETE ON "shop_promo_codes" FOR EACH ROW EXECUTE FUNCTION "forward_retired_shop_promo_codes"();--> statement-breakpoint
CREATE FUNCTION "forward_retired_trip_last_minute_promos"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "deals" WHERE "id" = OLD."id" AND "trip_id" IS NOT NULL;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    UPDATE "deals" SET "status" = CASE NEW."status" WHEN 'sent' THEN 'active'::"deal_status" WHEN 'failed' THEN 'failed'::"deal_status" ELSE 'pending'::"deal_status" END,
      "stripe_coupon_id" = NEW."stripe_coupon_id", "stripe_promotion_code_id" = NEW."stripe_promotion_code_id",
      "recipient_count" = NEW."recipient_count", "created_by_person_id" = NEW."created_by_person_id"
    WHERE "id" = NEW."id" AND "trip_id" IS NOT NULL;
    RETURN NEW;
  END IF;
  INSERT INTO "deals" ("id", "shop_id", "trip_id", "code", "discount_percent", "discount_amount_cents", "status", "expires_at", "max_redemptions", "stripe_coupon_id", "stripe_promotion_code_id", "recipient_count", "created_by_person_id", "created_at")
  VALUES (NEW."id", NEW."shop_id", NEW."trip_id", NEW."code", NEW."discount_percent", NEW."discount_amount_cents", CASE NEW."status" WHEN 'sent' THEN 'active'::"deal_status" WHEN 'failed' THEN 'failed'::"deal_status" ELSE 'pending'::"deal_status" END, NEW."expires_at", NEW."max_redemptions", NEW."stripe_coupon_id", NEW."stripe_promotion_code_id", NEW."recipient_count", NEW."created_by_person_id", NEW."created_at")
  ON CONFLICT ("id") DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "forward_retired_trip_last_minute_promos" AFTER INSERT OR UPDATE OR DELETE ON "trip_last_minute_promos" FOR EACH ROW EXECUTE FUNCTION "forward_retired_trip_last_minute_promos"();--> statement-breakpoint
CREATE FUNCTION "fill_deal_id_from_retired_promo"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."deal_id" IS NULL THEN
    NEW."deal_id" := coalesce(NEW."promo_code_id", NEW."trip_promo_id");
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "fill_deal_id_from_retired_promo" BEFORE INSERT OR UPDATE ON "booking_checkouts" FOR EACH ROW EXECUTE FUNCTION "fill_deal_id_from_retired_promo"();--> statement-breakpoint
CREATE TRIGGER "fill_deal_id_from_retired_promo" BEFORE INSERT OR UPDATE ON "payment_operation_intents" FOR EACH ROW EXECUTE FUNCTION "fill_deal_id_from_retired_promo"();
