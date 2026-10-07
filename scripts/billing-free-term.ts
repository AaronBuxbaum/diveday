/**
 * `pnpm billing:free-term <shop-slug> <last-free-day | none>` — grant, move or
 * withdraw a shop's founding free months (ADR 20261007-subscription-billing).
 *
 * The product has no operator identity, so this is the one hand that writes
 * `shop_subscriptions.free_term_ends_on`. It runs against whatever database
 * `getDb()` resolves: `DATABASE_URL` when set (production, through
 * `dotenv -c`), the dev PGlite directory otherwise — which allows one process
 * at a time, so stop `pnpm dev` first.
 *
 * The date is the shop's last free day, inclusive, in the shop's own zone. A
 * shop that already holds a Stripe subscription keeps the charge date Stripe
 * holds; the script says so, because moving that date is a Stripe dashboard
 * change (the subscription's trial end), not a DiveDay one.
 */
import { getDb } from "@/db/client";
import { setShopFreeTerm } from "@/db/shop-subscriptions";

const USAGE = "Usage: pnpm billing:free-term <shop-slug> <YYYY-MM-DD | none>";

async function main(argv: readonly string[]): Promise<number> {
  const [shopSlug, day] = argv;
  if (!shopSlug || !day) {
    console.error(USAGE);
    return 2;
  }
  const endsOn = day === "none" ? null : day;
  const db = await getDb();
  const outcome = await setShopFreeTerm(db, { shopSlug, endsOn });
  if (outcome.status === "no_such_shop") {
    console.error(`No shop has the slug "${shopSlug}".`);
    return 1;
  }
  if (outcome.status === "invalid_date") {
    console.error(`"${day}" is not a calendar date. ${USAGE}`);
    return 2;
  }
  console.log(
    endsOn ? `${shopSlug} is free through ${endsOn}.` : `${shopSlug} no longer has a free term.`,
  );
  if (outcome.hasLiveSubscription) {
    console.warn(
      "This shop already has a Stripe subscription: Stripe keeps its own next charge date. Change the subscription's trial end in the Stripe dashboard to match.",
    );
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
