import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createBookingParty, setBookingParticipantType } from "./bookings";
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
  /**
   * **The type is the one the seat has when the recap is built, not the one it
   * was sold as** (issue #2383 review). A rider moved to the water at the desk
   * is a diver now and is told when to fly; a diver moved to snorkeling or to
   * the boat is not, whatever `booked_as` still says.
   */
  it.each([
    { sold: "rider", now: "diver", told: true },
    { sold: "diver", now: "snorkeler", told: false },
    { sold: "diver", now: "rider", told: false },
  ] as const)(
    "keys the flying line on the current type: sold as $sold, now $now",
    async ({ sold, now, told }) => {
      const { db, shop, reef, afterTrip } = await recapContext();
      const [staff] = await listStaff(db, shop.id);
      if (!staff) throw new Error("no staff");
      const email = `recap-switch-${sold}-${now}@example.com`;
      const party = await createBookingParty(db, [
        {
          actor: "staff",
          shopId: shop.id,
          tripId: reef.id,
          fullName: "Sam Switcher",
          email,
          participantType: sold,
        },
      ]);
      if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
      const bookingId = party.bookings[0].bookingId;
      const changed = await setBookingParticipantType(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId,
        to: now,
        actorPersonId: staff.person.id,
        confirmCertBlock: true,
      });
      expect(changed.ok).toBe(true);
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

      const sender = fakeEmail();
      await sendDueRecaps(db, {
        now: afterTrip,
        emailProvider: sender.provider,
        smsProvider: fakeSms().provider,
        appOrigin: ORIGIN,
      });
      const sent = sender.sent.find((n) => n.kind === "trip_recap" && n.bookingId === bookingId);
      if (sent?.kind !== "trip_recap") throw new Error("no recap sent");
      const page = await getRecapPageData(db, bookingId);
      if (told) {
        expect(sent.flySafe).not.toBeNull();
        expect(page?.flySafe).not.toBeNull();
      } else {
        expect(sent.flySafe ?? null).toBeNull();
        expect(page?.flySafe ?? null).toBeNull();
      }
    },
  );
});
