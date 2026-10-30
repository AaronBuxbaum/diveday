import { describe, expect, it } from "vitest";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { fileScopedShopContext } from "@/test/db";
import { createTrip, listTripIdsInOfflineManifestWindow } from "./trips";

const ctx = fileScopedShopContext();

describe("offline-manifest auto-save window", () => {
  it("includes the exact return cutoff, excludes one millisecond older, and keeps the future cap", async () => {
    const { db, shop } = ctx;
    const now = new Date("2030-08-15T12:00:00.000Z");
    const until = new Date(now.getTime() + 60 * 60 * 1000);

    const exactReturn = await createTrip(db, {
      shopId: shop.id,
      title: "At the offline-manifest return cutoff",
      startsAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() - DEPARTURE_BUFFER_MS),
      capacity: 4,
    });
    const beforeReturnCutoff = await createTrip(db, {
      shopId: shop.id,
      title: "Before the offline-manifest return cutoff",
      startsAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() - DEPARTURE_BUFFER_MS - 1),
      capacity: 4,
    });
    const atFutureCap = await createTrip(db, {
      shopId: shop.id,
      title: "At the offline-manifest future cap",
      startsAt: until,
      endsAt: new Date(until.getTime() + 4 * 60 * 60 * 1000),
      capacity: 4,
    });
    const afterFutureCap = await createTrip(db, {
      shopId: shop.id,
      title: "After the offline-manifest future cap",
      startsAt: new Date(until.getTime() + 1),
      endsAt: new Date(until.getTime() + 5 * 60 * 60 * 1000),
      capacity: 4,
    });
    if (!exactReturn || !beforeReturnCutoff || !atFutureCap || !afterFutureCap) {
      throw new Error("trip creation failed");
    }

    const ids = new Set(await listTripIdsInOfflineManifestWindow(db, shop.id, now, until));
    expect(ids.has(exactReturn.id)).toBe(true);
    expect(ids.has(beforeReturnCutoff.id)).toBe(false);
    expect(ids.has(atFutureCap.id)).toBe(true);
    expect(ids.has(afterFutureCap.id)).toBe(false);
  });
});
