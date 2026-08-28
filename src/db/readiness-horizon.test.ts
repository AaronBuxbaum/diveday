// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { arrivalsWindow, operationalWindow, withinWindow } from "@/lib/operational-window";
import { seededShopContext } from "@/test/db";
import { countBlockedDivers, inHorizonReadiness } from "./blockers";
import { listCheckInQueue, listWalkInTrips } from "./check-in";
import { getTodayWork } from "./today";

/**
 * The cross-surface contract of the shared window model (task 141): the day
 * spine, the nav badge and Check-in read one horizon, so a diver cleared on one
 * is cleared on the others and their counts agree. These are the assertions
 * that would have caught the three-horizon drift — each surface's own file only
 * ever checked itself.
 */
const NOW = nowDate();

/** Who each in-horizon departure is still holding up, from the shared pass. */
async function blockedByTrip(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
): Promise<Map<string, Set<string>>> {
  const evidence = await inHorizonReadiness(db, shopId, NOW);
  const byTrip = new Map<string, Set<string>>();
  for (const trip of evidence.trips) {
    const people = new Set<string>();
    for (const row of evidence.readinessByTrip.get(trip.id) ?? []) {
      if (row.readiness.status === "blocked") people.add(row.person.id);
    }
    if (people.size > 0) byTrip.set(trip.id, people);
  }
  return byTrip;
}

describe("one operational window across the readiness surfaces", () => {
  it("a station's blocked count is the shared readiness pass's own answer", async () => {
    const { db, shop } = await seededShopContext();
    const [work, blocked] = await Promise.all([
      getTodayWork(db, shop.id, shop.slug, shop.timezone, NOW),
      blockedByTrip(db, shop.id),
    ]);

    const blockedToday = work.departures.filter((departure) => departure.blocked > 0);
    expect(blockedToday.length).toBeGreaterThan(0);
    for (const departure of blockedToday) {
      // Same departure, same number of blocked divers — one query horizon and
      // one readiness pass behind both the station's figure and the badge.
      expect(blocked.get(departure.tripId)?.size).toBe(departure.blocked);
    }
    // And the reverse: a departure the spine reports as clear is not one the
    // shared pass is still holding blocked divers for.
    for (const departure of work.departures) {
      if (departure.blocked === 0) expect(blocked.has(departure.tripId)).toBe(false);
    }
  });

  it("the nav badge counts every distinct diver Today reports blocked, and never fewer", async () => {
    const { db, shop } = await seededShopContext();
    const [work, badge] = await Promise.all([
      getTodayWork(db, shop.id, shop.slug, shop.timezone, NOW),
      countBlockedDivers(db, shop.id, NOW),
    ]);
    const blockedToday = work.departures.reduce((sum, departure) => sum + departure.blocked, 0);
    expect(blockedToday).toBeGreaterThan(0);
    // Today is one day inside the badge's window, so the badge is a superset —
    // never a smaller number than the page it links away from.
    expect(badge).toBeGreaterThanOrEqual(blockedToday);
  });

  it("keeps every counter arrival inside its own window, and every future one inside the horizon", async () => {
    const { db, shop } = await seededShopContext();
    const arrivals = arrivalsWindow(NOW);
    const horizon = operationalWindow(NOW);
    const queue = await listCheckInQueue(db, shop.id, { now: NOW });
    expect(queue.length).toBeGreaterThan(0);

    for (const row of queue) {
      expect(withinWindow(arrivals, row.startsAt)).toBe(true);
      // The lookback is the one place the counter reaches outside the horizon,
      // and only backwards: nothing ahead of now escapes it.
      if (row.startsAt >= NOW) expect(withinWindow(horizon, row.startsAt)).toBe(true);
    }
  });

  it("shows no blocked diver at the counter the shared pass has already cleared", async () => {
    const { db, shop } = await seededShopContext();
    const [counter, blocked] = await Promise.all([
      listCheckInQueue(db, shop.id, { now: NOW }),
      blockedByTrip(db, shop.id),
    ]);
    const onNotReady = new Set(
      [...blocked].flatMap(([tripId, people]) =>
        [...people].map((personId) => `${tripId}:${personId}`),
      ),
    );
    const upcomingBlocked = counter.filter(
      (row) => row.startsAt >= NOW && row.readiness.status === "blocked",
    );
    expect(upcomingBlocked.length).toBeGreaterThan(0);
    for (const row of upcomingBlocked) {
      expect(onNotReady.has(`${row.tripId}:${row.personId}`)).toBe(true);
    }
  });

  it("offers walk-ins only trips the counter queue itself reads", async () => {
    const { db, shop } = await seededShopContext();
    const arrivals = arrivalsWindow(NOW);
    const options = await listWalkInTrips(db, shop.id, NOW);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(withinWindow(arrivals, option.startsAt)).toBe(true);
  });
});
