import { describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { manifestContext } from "../test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest, recordRollCall } from "./manifests";

vi.mock("@/lib/log", () => ({ log: vi.fn() }));

const MINUTE_MS = 60 * 1000;

/**
 * A boat tablet's clock is not the server's. Roll call orders marks by the
 * time each was made, and an offline mark carries the tablet's own reading, so
 * a tablet that runs fast stamps its marks in the server's future.
 */
describe("offline roll call from a tablet whose clock runs fast", () => {
  it("lets a later live 'not back aboard' stand over a mark the fast tablet synced first", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const now = nowMs();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };

    // The tablet is four minutes fast. Its "back aboard" reaches the server now.
    await expect(
      recordRollCall(db, {
        ...base,
        status: "boarded",
        source: "offline",
        clientEventId: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
        offlineSnapshotSavedAt: new Date(now - 60 * MINUTE_MS),
        occurredAt: new Date(now + 4 * MINUTE_MS),
      }),
    ).resolves.toMatchObject({ ok: true });

    // A minute later a second crew member, on the live manifest, says the
    // diver did not come back. It is the newest statement anybody has made.
    advanceClock(MINUTE_MS);
    await expect(recordRollCall(db, { ...base, status: "not_boarded" })).resolves.toMatchObject({
      ok: true,
    });

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(
      manifest?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });

  it("keeps a 'not back aboard' from a tablet running more than the tolerance fast", async () => {
    const { db, shop, reef, booking, staff } = await manifestContext();
    const now = nowMs();

    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        source: "offline",
        clientEventId: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
        offlineSnapshotSavedAt: new Date(now - 60 * MINUTE_MS),
        occurredAt: new Date(now + 12 * MINUTE_MS),
      }),
    ).resolves.toMatchObject({ ok: true });

    const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
    expect(
      manifest?.divers.find((entry) => entry.bookingId === booking.booking.id)?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });
});
