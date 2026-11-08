import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { sendDueRecaps } from "@/test/words-wiring";
import {
  bookingsLeftAtTheDock,
  bookingsNeverCountedAtRollCall,
  getRecapPageData,
} from "../features/recap/store";
import { createBookingParty } from "./bookings";
import { bookingArrivalEvents, notificationDeliveries, rollCallEvents } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **A diver nobody counted, on a departure whose roll call was taken** (issue
 * #3822). The crew stood at the dock and counted everyone else; this seat has
 * no word at any checkpoint. No clock says they dived, so the recap page and
 * the recap send stay shut, as for a diver left at the dock. A departure with
 * no roll call at all keeps sending to everyone (`recap.test.ts`).
 */
async function counted() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  const [staff] = await listStaff(db, shop.id);
  if (!reef || !staff) throw new Error("demo reef trip or staff missing");
  const party = await createBookingParty(
    db,
    [
      ["Cy Counted", "cy-counted@example.com"],
      ["Una Uncounted", "una-uncounted@example.com"],
    ].map(([fullName, email]) => ({
      actor: "staff" as const,
      shopId: shop.id,
      tripId: reef.id,
      fullName: fullName as string,
      email: email as string,
    })),
  );
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const [cy, una] = party.bookings.map((b) => b.bookingId);
  if (!cy || !una) throw new Error("party bookings missing");
  let minute = 0;
  const record = (bookingId: string, status: "boarded" | "not_boarded", checkpoint = "departure") =>
    db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      recordedByPersonId: staff.person.id,
      status,
      checkpoint,
      occurredAt: new Date(reef.startsAt.getTime() + minute++ * 60 * 1000),
    });
  const candidate = (id: string) => ({
    booking: { id },
    shop: { id: shop.id },
    trip: { id: reef.id },
  });
  const afterTrip = new Date(reef.endsAt.getTime() + 15 * 60 * 60 * 1000);
  const arrive = (bookingId: string) =>
    db.insert(bookingArrivalEvents).values({
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      recordedByPersonId: staff.person.id,
      status: "arrived",
      source: "live",
      occurredAt: reef.startsAt,
    });
  return { db, cy, una, record, candidate, afterTrip, arrive };
}

const options = (afterTrip: Date, email: ReturnType<typeof fakeEmail>) => ({
  now: afterTrip,
  emailProvider: email.provider,
  smsProvider: fakeSms().provider,
  appOrigin: "https://diveday.test",
});

describe("a diver nobody counted on a counted departure", () => {
  it("is in the set the afterglow asks, and the counted diver is not", async () => {
    const { db, cy, una, record, candidate } = await counted();
    await record(cy, "boarded");
    expect(await bookingsNeverCountedAtRollCall(db, [cy, una].map(candidate))).toEqual(
      new Set([una]),
    );
    expect(await bookingsLeftAtTheDock(db, [cy, una].map(candidate))).toEqual(new Set([una]));
  });

  it("is in no set where nobody was counted at all", async () => {
    const { db, cy, una, candidate } = await counted();
    expect(await bookingsNeverCountedAtRollCall(db, [cy, una].map(candidate))).toEqual(new Set());
  });

  it("gets no recap page and no recap email, while the counted diver gets both", async () => {
    const { db, cy, una, record, afterTrip } = await counted();
    await record(cy, "boarded");
    expect(await getRecapPageData(db, una)).toBeNull();
    expect(await getRecapPageData(db, cy)).not.toBeNull();
    const email = fakeEmail();
    await sendDueRecaps(db, options(afterTrip, email));
    const sentTo = (id: string) =>
      email.sent.filter((n) => n.kind === "trip_recap" && n.bookingId === id);
    expect(sentTo(cy)).toHaveLength(1);
    expect(sentTo(una)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.bookingId, una)),
    ).toHaveLength(0);
  });

  it("is owed the recap once a later checkpoint names them aboard", async () => {
    const { db, cy, una, record, candidate } = await counted();
    await record(cy, "boarded");
    await record(una, "boarded", "after_dive_1");
    expect(await bookingsNeverCountedAtRollCall(db, [candidate(una)])).toEqual(new Set());
    expect(await getRecapPageData(db, una)).not.toBeNull();
  });

  it("tells the logbook sheet what the shop saw, from the recap's own reads (reviews of #2745)", async () => {
    const { db, cy, una, record, arrive } = await counted();
    // Cy: boarded at the dock. Una: left at the dock, joined at the second
    // site, and seen at the desk.
    await record(cy, "boarded");
    await record(una, "not_boarded");
    await record(una, "boarded", "after_dive_1");
    await arrive(una);
    expect((await getRecapPageData(db, cy))?.seenThatDay).toEqual({
      boardedAtRollCall: true,
      arrivedAtDesk: false,
    });
    expect((await getRecapPageData(db, una))?.seenThatDay).toEqual({
      boardedAtRollCall: true,
      arrivedAtDesk: true,
    });
  });
});
