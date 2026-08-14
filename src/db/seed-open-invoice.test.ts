import { describe, expect, it } from "vitest";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import { seededShopContext } from "@/test/db";
import { countOpenTripOrders } from "./orders";
import { listTripReadiness } from "./readiness";
import { upcomingTripsWithCounts } from "./trips";

/**
 * The trip Overview's pulse states "N orders are awaiting payment" only when a
 * departure has open orders, and no seeded departure had one — so the fact
 * rendered on no page in the demo, had no visual baseline, and could not be
 * clicked by a test.
 *
 * The two properties that make it safe to seed are that it is *visible* and
 * that it settles nothing. Both are pinned here, because the second is the one
 * `seed-orders.ts`'s `bookingId: null` rule exists to protect.
 */
async function reefTrip() {
  const { db, shop } = await seededShopContext({ history: true });
  // Today's boat. Scanned from now rather than the epoch for the same reason
  // seed-desk-trail.test.ts does it: the history back-fill reuses these titles
  // on departures that already sailed.
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((row) => row.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("seeded reef trip missing");
  return { db, shop, trip };
}

describe("seeded open invoice", () => {
  it("gives today's reef departure one order awaiting payment, so the pulse has a fact", async () => {
    const { db, shop, trip } = await reefTrip();
    expect(await countOpenTripOrders(db, shop.id, trip.id)).toBe(1);
  });

  it("settles nothing, which is why `open` is the status that may be booking-linked", async () => {
    const { db, shop, trip } = await reefTrip();
    // `applyOrderUpdate` cascades a booking-linked order onto its seat's payment
    // gate on *settlement*; an open invoice settles nothing. So no seat on this
    // departure is held by payment, and the readiness counts that
    // e2e/check-in.spec.ts and e2e/today.spec.ts assert exactly are untouched.
    const readiness = await listTripReadiness(db, shop.id, trip.id);
    expect(readiness.length).toBeGreaterThan(0);
    // Read through BLOCKER_CATEGORY rather than matching on the code's spelling:
    // a blocker is a typed `{ code }`, and a substring test would quietly stop
    // catching anything the day a payment code is renamed.
    const heldByPayment = readiness.filter((row) =>
      row.readiness.blockers.some((blocker) => BLOCKER_CATEGORY[blocker.code] === "payment"),
    );
    expect(heldByPayment).toHaveLength(0);
  });
});
