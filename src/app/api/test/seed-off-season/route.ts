import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { createTrip } from "@/db/trips";
import { liveTrip } from "@/db/trips-live";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { hasSailed } from "@/lib/trips";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * **Empties a demo shop's board, so the off-season can be photographed** (N-45).
 *
 * The storefront's quiet state is the one thing the seeded fixture can never
 * be: `blue-mantis` exists to have a full board, and a demo shop that showed a
 * stranger nothing would be a worse demo (the same argument
 * `seed-trouble-states` makes for the panels that only appear on a shop's worst
 * day). So the state is written by a test route instead of seeded, and the
 * spec that wants it asks for it.
 *
 * Two shapes, because the card has two and they say different things:
 *
 * - no `?opensInDays=` — every upcoming departure is deleted and the shop has
 *   nothing scheduled at all. The card then names the soonest **season** the
 *   shop has written, if it has written one.
 * - `?opensInDays=45` — the same clear-out, then one ordinary departure that
 *   far out. The card names **that date**, because a departure the shop
 *   scheduled outranks a week it merely wrote about (`src/lib/off-season.ts`).
 *
 * The delete is the product's own soft delete (`trips.deleted_at`, ADR
 * 20260820-every-delete-is-soft) — every read this exercises filters through
 * `liveTrip()`, so a hard delete would be testing a state the app cannot
 * produce. Departures already in the past are left where they are: a shop
 * between seasons has a season behind it, and that is what keeps the deal list
 * and the find-my-link door on the page.
 *
 * `?slug=` names the shop and defaults to the shared fixture, which is safe to
 * mutate because each Playwright worker owns its database and
 * `/api/test/reset` restores the schedule before every test. Refuses anything
 * that is not an `isDemo` tenant, and gated identically to `/api/test/reset`,
 * so it can never be reachable in a real deployment.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug") ?? DEMO_SHOP_SLUG;
  const raw = params.get("opensInDays");
  const opensInDays = raw === null ? null : Number(raw);
  // Refused rather than sanitised, like every other parameter on these routes:
  // a spec that asked for a departure and silently got none would photograph
  // the wrong half of the card.
  if (opensInDays !== null && (!Number.isInteger(opensInDays) || opensInDays < 1)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, slug);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });

  const now = nowDate();
  // `hasSailed`, never a second buffer constant: a departure is "still ahead"
  // in exactly one place in this repository, and the hour of grace it allows a
  // late boat is the same hour `upcomingScheduleRange` allows — which is the
  // list this route is emptying.
  const live = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(and(liveTrip(), eq(trips.shopId, shop.id)));
  const ahead = live.filter((trip) => !hasSailed(trip.startsAt, now)).map((trip) => trip.id);
  if (ahead.length > 0) {
    await db.update(trips).set({ deletedAt: now }).where(inArray(trips.id, ahead));
  }

  let openedTripId: string | null = null;
  if (opensInDays !== null) {
    const startsAt = new Date(now.getTime() + opensInDays * DAY_MS);
    const created = await createTrip(db, {
      shopId: shop.id,
      // i18n-exempt: a test fixture's departure title, never a rendered string
      // the product owns — the same status the seed's own titles have.
      title: "Season Opener Two-Tank",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 12,
      priceCents: 14_500,
    });
    if (!created) return NextResponse.json({ error: "create_failed" }, { status: 500 });
    openedTripId = created.id;
  }

  return NextResponse.json({ ok: true, cleared: ahead.length, openedTripId });
}
