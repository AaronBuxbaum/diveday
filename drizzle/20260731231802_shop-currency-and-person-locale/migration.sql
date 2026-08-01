-- The language a diver reads, captured from their own request's
-- `Accept-Language`. Nullable with no backfill on purpose: null means "no
-- first-hand signal", and every existing person keeps falling back to the
-- shop's locale exactly as before this column existed.
ALTER TABLE "people" ADD COLUMN "locale" text;--> statement-breakpoint
-- The shop's declared currency for every amount it displays or charges.
-- Defaults 'usd' — then backfilled from the connected Stripe account's own
-- settlement currency where one is already connected, so a shop that has been
-- charging in EUR since task 60 keeps reading EUR instead of silently
-- reverting to dollars the moment this column becomes the source of truth.
-- Fresh installs backfill nothing; the table is empty.
ALTER TABLE "shops" ADD COLUMN "currency" text DEFAULT 'usd' NOT NULL;--> statement-breakpoint
-- Constrained to the currencies the app can actually represent
-- (`SHOP_CURRENCIES`, src/lib/money.ts). Stripe settles in ~135; copying one
-- we don't carry would store a code every read then narrows back to 'usd'
-- through `toShopCurrency`, re-denominating the exact shops this backfill
-- exists to protect — and hiding it, since the settings picker renders the
-- narrowed value too (security-reviewer finding). An account reporting an
-- unsupported currency keeps the 'usd' default and surfaces as a mismatch
-- warning in settings, which is a visible prompt to pick one rather than a
-- silent switch.
UPDATE "shops" AS "s" SET "currency" = "sa"."default_currency" FROM "shop_stripe_accounts" AS "sa" WHERE "sa"."shop_id" = "s"."id" AND "sa"."default_currency" IN ('usd','eur','gbp','cad','aud','nzd','mxn','brl','thb','idr','php','myr','sgd','jpy','egp','zar','ils','chf','dkk','nok','sek');
