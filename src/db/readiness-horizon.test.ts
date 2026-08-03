// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { arrivalsWindow, operationalWindow, withinWindow } from "@/lib/operational-window";
import { seededShopContext } from "@/test/db";
import { countBlockedDivers, getBlockerQueue } from "./blockers";
import { listCheckInQueue, listWalkInTrips } from "./check-in";
import { getTodayWork } from "./today";

/**
 * The cross-surface contract of the shared window model (task 141): Today, Not
 * ready, and Check-in read one horizon, so a diver cleared on one is cleared on
 * the others and their counts agree. These are the assertions that would have
 * caught the three-horizon drift — each surface's own file only ever checked
 * itself.
 */
const NOW = nowDate();

describe("one operational window across the readiness surfaces", () => {
  it("Today and Not ready agree on which of today's departures still hold divers up", async () => {
    const { db, shop } = await seededShopContext();
    const [work, queue] = await Promise.all([
      getTodayWork(db, shop.id, shop.slug, shop.timezone, NOW),
      getBlockerQueue(db, shop.id, shop.slug, NOW),
    ]);

    const blockedInQueue = new Map(queue.trips.map((trip) => [trip.tripId, trip.divers.length]));
    const blockedToday = work.departures.filter((departure) => departure.blocked > 0);
    expect(blockedToday.length).toBeGreaterThan(0);
    for (const departure of blockedToday) {
      // Same departure, same number of blocked divers — two lenses, one query
      // horizon and one readiness pass.
      expect(blockedInQueue.get(departure.tripId)).toBe(departure.blocked);
    }
    // And the reverse: a departure Today reports as clear is not sitting on the
    // Not ready queue with blocked divers on it.
    for (const departure of work.departures) {
      if (departure.blocked === 0) expect(blockedInQueue.has(departure.tripId)).toBe(false);
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

  it("shows no blocked diver at the counter that Not ready has already dropped", async () => {
    const { db, shop } = await seededShopContext();
    const [counter, queue] = await Promise.all([
      listCheckInQueue(db, shop.id, { now: NOW }),
      getBlockerQueue(db, shop.id, shop.slug, NOW),
    ]);
    const onNotReady = new Set(
      queue.trips.flatMap((trip) => trip.divers.map((diver) => `${trip.tripId}:${diver.personId}`)),
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
