import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { upsertExecutedDive } from "./executed-dives";
import { getRecapPageData, sendDueRecaps } from "./recap";
import { listStaff, upcomingTripsWithCounts } from "./trips";

const ORIGIN = "https://diveday.test";
const ctx = fileScopedShopContext();

/** A diver booked on the demo reef day, and the morning after the boat ties up (the recap is due). */
async function recapContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Rae Recap",
      email: "recap-rae@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  const afterTrip = new Date(reef.endsAt.getTime() + 15 * 60 * 60 * 1000);
  return { db, shop, reef, bookingId, afterTrip };
}

describe("the recap and flying, by participant type", () => {
  /**
   * **A rider or a snorkeler is told nothing about flying** (issue #2383,
   * decided by Aaron 2026-10-13). A rider never entered the water, so "24 hours
   * after your last dive with us, following DAN's guidance" is false for them;
   * a snorkeler gets the same silence. The diver beside them keeps the sentence.
   */
  it.each(["rider", "snorkeler"] as const)(
    "says nothing about flying to a %s, in the email or on the page, while the diver beside them keeps it",
    async (participantType) => {
      const { db, shop, reef, bookingId, afterTrip } = await recapContext();
      const [staff] = await listStaff(db, shop.id);
      if (!staff) throw new Error("no staff");
      const aboard = await createBookingParty(db, [
        {
          actor: "staff",
          shopId: shop.id,
          tripId: reef.id,
          fullName: "Pat Passenger",
          email: "recap-pat@example.com",
          participantType,
        },
      ]);
      if (!aboard.ok) throw new Error(`booking failed: ${aboard.reason}`);
      const aboardBookingId = aboard.bookings[0].bookingId;
      const lastExit = new Date(reef.endsAt.getTime() - 30 * 60 * 1000);
      for (const [diveNumber, exitedAt] of [
        [1, new Date(lastExit.getTime() - 2 * 60 * 60 * 1000)],
        [2, lastExit],
      ] as const) {
        const recorded = await upsertExecutedDive(db, {
          shopId: shop.id,
          tripId: reef.id,
          diveNumber,
          enteredAt: new Date(exitedAt.getTime() - 45 * 60 * 1000),
          exitedAt,
          recordedByPersonId: staff.person.id,
        });
        expect(recorded.ok).toBe(true);
      }

      const email = fakeEmail();
      await sendDueRecaps(db, {
        now: afterTrip,
        emailProvider: email.provider,
        smsProvider: fakeSms().provider,
        appOrigin: ORIGIN,
      });
      const recapFor = (id: string) => {
        const sent = email.sent.find((n) => n.kind === "trip_recap" && n.bookingId === id);
        if (sent?.kind !== "trip_recap") throw new Error(`no recap for ${id}`);
        return sent;
      };
      expect(recapFor(aboardBookingId).flySafe ?? null).toBeNull();
      expect((await getRecapPageData(db, aboardBookingId))?.flySafe ?? null).toBeNull();
      // The diver on the same boat, same dive: the sentence is still there.
      expect(recapFor(bookingId).flySafe).not.toBeNull();
      expect((await getRecapPageData(db, bookingId))?.flySafe).toEqual(recapFor(bookingId).flySafe);
    },
  );
});
