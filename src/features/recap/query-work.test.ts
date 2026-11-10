import { describe, expect, it, vi } from "vitest";
import { createBookingParty } from "../../db/bookings";
import * as executedDiveReads from "../../db/executed-dives";
import { upcomingTripsWithCounts } from "../../db/trips";
import { fileScopedShopContext } from "../../test/db";
import { fakeEmail, fakeSms } from "../../test/fakes";
import { sendTripRecaps } from "../../test/words-wiring";

const ctx = fileScopedShopContext();
const ORIGIN = "https://diveday.test";

async function recapContext(
  source = ctx,
  diver = { fullName: "Rae Recap", email: "recap-rae@example.com" },
) {
  const { db, shop } = source;
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((trip) =>
    trip.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      ...diver,
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  return { db, shop, reef, afterTrip: new Date(reef.endsAt.getTime() + 15 * 60 * 60 * 1000) };
}

describe("recap hydration work", () => {
  it("hydrates one departure once for several unsent recipients", async () => {
    const { db, shop, reef, afterTrip } = await recapContext();
    await recapContext(ctx, { fullName: "Sam Recap", email: "recap-sam@example.com" });
    const read = vi.spyOn(executedDiveReads, "listExecutedDives");
    try {
      await sendTripRecaps(db, {
        shopId: shop.id,
        tripId: reef.id,
        options: {
          now: afterTrip,
          emailProvider: fakeEmail().provider,
          smsProvider: fakeSms().provider,
          appOrigin: ORIGIN,
        },
      });
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
  });

  it("does not hydrate fly-safe facts after every recap on a trip was delivered", async () => {
    const { db, shop, reef, afterTrip } = await recapContext();
    const opts = {
      now: afterTrip,
      emailProvider: fakeEmail().provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    };
    await sendTripRecaps(db, { options: opts, shopId: shop.id, tripId: reef.id });
    const read = vi.spyOn(executedDiveReads, "listExecutedDives");
    try {
      await sendTripRecaps(db, { options: opts, shopId: shop.id, tripId: reef.id });
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
});
