import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upcomingTripsWithCounts } from "@/db/trips";
import { seededShopContext } from "@/test/db";
import {
  COALESCE_WINDOW_MS,
  claimDuePushTargets,
  deletePushSubscription,
  deletePushSubscriptionsById,
  isDeviceSubscribed,
  isDeviceSubscribedAnywhere,
  savePushSubscription,
} from "./push-subscriptions";
import { pushSubscriptions } from "./schema";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-a";
const OTHER_ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-b";

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((candidate) => candidate.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("expected seeded trip missing");
  return { db, shop, trip };
}

/** A staff person id from the seeded shop, for the subscription's owner column. */
async function staffPersonId(db: Awaited<ReturnType<typeof context>>["db"], shopId: string) {
  const { people } = await import("./schema");
  const [row] = await db.select({ id: people.id }).from(people).where(eq(people.shopId, shopId));
  if (!row) throw new Error("expected a seeded person");
  return row.id;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("savePushSubscription", () => {
  it("refuses a trip that belongs to another shop", async () => {
    const { db, shop } = await context();
    const personId = await staffPersonId(db, shop.id);
    const outcome = await savePushSubscription(db, {
      shopId: shop.id,
      tripId: "11111111-1111-1111-1111-111111111111",
      personId,
      endpoint: ENDPOINT,
      p256dh: "p",
      auth: "a",
    });
    // The tenant check: a caller cannot register against a trip that is not
    // their shop's, and gets a code rather than a sentence.
    expect(outcome).toEqual({ ok: false, reason: "not_found" });
  });

  it("upserts rather than accumulating rows when a device re-subscribes", async () => {
    const { db, shop, trip } = await context();
    const personId = await staffPersonId(db, shop.id);
    const input = {
      shopId: shop.id,
      tripId: trip.id,
      personId,
      endpoint: ENDPOINT,
      p256dh: "p",
      auth: "a",
    };
    expect(await savePushSubscription(db, input)).toEqual({ ok: true });
    expect(await savePushSubscription(db, { ...input, p256dh: "rotated" })).toEqual({ ok: true });

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.tripId, trip.id));
    // One row, carrying the newer key — not two rows both pushing one phone.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe("rotated");
  });

  it("does not reset the coalescing window when a device re-subscribes", async () => {
    const { db, shop, trip } = await context();
    const personId = await staffPersonId(db, shop.id);
    const input = {
      shopId: shop.id,
      tripId: trip.id,
      personId,
      endpoint: ENDPOINT,
      p256dh: "p",
      auth: "a",
    };
    await savePushSubscription(db, input);
    const now = trip.startsAt;
    await claimDuePushTargets(db, shop.id, trip.id, now);

    // Re-subscribing must not hand back an immediate extra push, or a device
    // that reconnects in a loop becomes a way to bypass the throttle.
    await savePushSubscription(db, { ...input, p256dh: "rotated" });
    expect(await claimDuePushTargets(db, shop.id, trip.id, now)).toEqual([]);
  });
});

describe("claimDuePushTargets", () => {
  async function subscribed() {
    const { db, shop, trip } = await context();
    const personId = await staffPersonId(db, shop.id);
    await savePushSubscription(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId,
      endpoint: ENDPOINT,
      p256dh: "p",
      auth: "a",
    });
    return { db, shop, trip };
  }

  it("claims a due subscription once and then coalesces inside the window", async () => {
    const { db, shop, trip } = await subscribed();
    const now = trip.startsAt;

    const first = await claimDuePushTargets(db, shop.id, trip.id, now);
    expect(first).toHaveLength(1);
    expect(first[0]?.endpoint).toBe(ENDPOINT);

    // The burst case: more roll-call writes land immediately after. They must
    // collapse into the one notification already sent.
    const second = await claimDuePushTargets(db, shop.id, trip.id, now);
    expect(second).toEqual([]);

    const stillInside = new Date(now.getTime() + COALESCE_WINDOW_MS - 1);
    expect(await claimDuePushTargets(db, shop.id, trip.id, stillInside)).toEqual([]);
  });

  it("claims again once the coalescing window has passed", async () => {
    const { db, shop, trip } = await subscribed();
    const now = trip.startsAt;
    await claimDuePushTargets(db, shop.id, trip.id, now);

    const afterWindow = new Date(now.getTime() + COALESCE_WINDOW_MS + 1);
    expect(await claimDuePushTargets(db, shop.id, trip.id, afterWindow)).toHaveLength(1);
  });

  // The departure window is no longer decided here — it is checked against the
  // live trip row before this runs, and its cases (boundaries, a moved trip, a
  // multi-day course) live in src/lib/push-window.test.ts. `claimDuePushTargets`
  // now owns exactly one throttle: coalescing.

  it("never claims another shop's subscriptions", async () => {
    const { db, trip } = await subscribed();
    expect(
      await claimDuePushTargets(db, "22222222-2222-2222-2222-222222222222", trip.id, trip.startsAt),
    ).toEqual([]);
  });
});

describe("deletePushSubscription", () => {
  it("deletes only within the caller's own shop", async () => {
    const { db, shop, trip } = await context();
    const personId = await staffPersonId(db, shop.id);
    await savePushSubscription(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId,
      endpoint: ENDPOINT,
      p256dh: "p",
      auth: "a",
    });

    // Another shop presenting the same endpoint must not be able to drop it.
    await deletePushSubscription(db, "22222222-2222-2222-2222-222222222222", trip.id, ENDPOINT);
    expect(
      await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.tripId, trip.id)),
    ).toHaveLength(1);

    await deletePushSubscription(db, shop.id, trip.id, ENDPOINT);
    expect(
      await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.tripId, trip.id)),
    ).toHaveLength(0);
  });
});

describe("deletePushSubscriptionsById", () => {
  it("is a no-op on an empty list rather than deleting everything", async () => {
    // A `where id = any('{}')` mistake here would wipe every subscription in
    // the table, so the empty case is asserted rather than assumed.
    const { db, shop, trip } = await context();
    const personId = await staffPersonId(db, shop.id);
    await savePushSubscription(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId,
      endpoint: ENDPOINT,
      p256dh: "p",
      auth: "a",
    });

    await deletePushSubscriptionsById(db, shop.id, []);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  it("deletes exactly the named rows", async () => {
    const { db, shop, trip } = await context();
    const personId = await staffPersonId(db, shop.id);
    for (const endpoint of [ENDPOINT, OTHER_ENDPOINT]) {
      await savePushSubscription(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId,
        endpoint,
        p256dh: "p",
        auth: "a",
      });
    }
    const rows = await db.select().from(pushSubscriptions);
    const doomed = rows.find((row) => row.endpoint === ENDPOINT);
    if (!doomed) throw new Error("expected the subscription just inserted");

    await deletePushSubscriptionsById(db, shop.id, [doomed.id]);
    const remaining = await db.select().from(pushSubscriptions);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.endpoint).toBe(OTHER_ENDPOINT);
  });
});

describe("per-trip subscription state", () => {
  /** Two departures the same captain might run on one day, one phone. */
  async function twoTrips() {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const [morning, afternoon] = trips;
    if (!morning || !afternoon) throw new Error("expected two seeded trips");
    const personId = await staffPersonId(db, shop.id);
    return { db, shop, morning, afternoon, personId };
  }

  it("reports on for the trip that has a row and off for the one that does not", async () => {
    // The bug this guards: the control used to derive its state from
    // `pushManager.getSubscription()`, which is origin-wide. A captain who
    // opted the morning trip in then saw the afternoon trip's control reading
    // "on" with no row behind it — and could not turn it on without first
    // turning the morning trip off.
    const { db, shop, morning, afternoon, personId } = await twoTrips();
    await savePushSubscription(db, {
      shopId: shop.id,
      tripId: morning.id,
      personId,
      endpoint: ENDPOINT,
      p256dh: "p",
      auth: "a",
    });

    expect(await isDeviceSubscribed(db, shop.id, morning.id, ENDPOINT)).toBe(true);
    expect(await isDeviceSubscribed(db, shop.id, afternoon.id, ENDPOINT)).toBe(false);
  });

  it("never reports another shop's row as this device's", async () => {
    const { db, shop, morning, personId } = await twoTrips();
    await savePushSubscription(db, {
      shopId: shop.id,
      tripId: morning.id,
      personId,
      endpoint: ENDPOINT,
      p256dh: "p",
      auth: "a",
    });
    expect(
      await isDeviceSubscribed(db, "22222222-2222-2222-2222-222222222222", morning.id, ENDPOINT),
    ).toBe(false);
  });

  it("keeps the browser subscription alive while another departure still needs it", async () => {
    // One phone, both boats. Turning the morning trip off must report that the
    // afternoon still wants pushes, so the caller does not tear down the shared
    // origin-wide subscription and silently kill the second boat.
    const { db, shop, morning, afternoon, personId } = await twoTrips();
    for (const trip of [morning, afternoon]) {
      await savePushSubscription(db, {
        shopId: shop.id,
        tripId: trip.id,
        personId,
        endpoint: ENDPOINT,
        p256dh: "p",
        auth: "a",
      });
    }

    expect(await deletePushSubscription(db, shop.id, morning.id, ENDPOINT)).toEqual({
      hasOtherTrips: true,
    });
    expect(await isDeviceSubscribed(db, shop.id, afternoon.id, ENDPOINT)).toBe(true);

    // …and once the last one goes, the caller is told it may unsubscribe.
    expect(await deletePushSubscription(db, shop.id, afternoon.id, ENDPOINT)).toEqual({
      hasOtherTrips: false,
    });
    expect(await isDeviceSubscribedAnywhere(db, shop.id, ENDPOINT)).toBe(false);
  });
});
