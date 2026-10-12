// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { listCheckInQueue } from "@/db/check-in";
import { bookings, trips } from "@/db/schema";
import { welcomeCueInputsByBooking } from "@/db/welcome-cues";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { buildArrivalDesk } = await import("./arrival-desk");

/** A seat at the counter whose diver has never been on one of this shop's boats. */
async function firstTimerAtTheCounter() {
  const { db, shop } = await seededShopContext();
  const now = nowDate();
  const queue = await listCheckInQueue(db, shop.id, { now });
  for (const row of queue) {
    if (row.bookingStatus !== "booked") continue;
    const inputs = await welcomeCueInputsByBooking(db, shop.id, row.tripId, now);
    if (inputs.get(row.bookingId)?.lastDivedAt === null) {
      const [trip] = await db.select().from(trips).where(eq(trips.id, row.tripId));
      if (trip)
        return { db, shop, now, trip, bookingId: row.bookingId, personName: row.personName };
    }
  }
  throw new Error("no first-timer is booked on a boat inside the arrivals window");
}

async function belowFor(seat: Awaited<ReturnType<typeof firstTimerAtTheCounter>>) {
  const desk = await buildArrivalDesk({
    db: seat.db,
    shopId: seat.shop.id,
    shopSlug: seat.shop.slug,
    tripId: seat.trip.id,
    trip: seat.trip,
    now: seat.now,
    locale: "en-US",
    timeZone: seat.shop.timezone,
    t: staffTranslator("en-US"),
  });
  if (!desk) throw new Error("the boat is outside its arrivals window");
  return render(<div>{desk.arrival.below.get(seat.bookingId)}</div>).container;
}

describe("the counter's welcome word (UX audit 2026-10-07, item 46)", () => {
  it("puts a consented first-timer's cue on their row at the desk", async () => {
    const seat = await firstTimerAtTheCounter();
    await seat.db
      .update(bookings)
      .set({ welcomeSharedAt: seat.now })
      .where(eq(bookings.id, seat.bookingId));
    expect(await belowFor(seat)).toHaveTextContent("first time with us");
  });

  it("puts the dock line under the cue: the first name to say and the card they hold (UX review 2026-10-10, item 36)", async () => {
    const seat = await firstTimerAtTheCounter();
    await seat.db
      .update(bookings)
      .set({ welcomeSharedAt: seat.now })
      .where(eq(bookings.id, seat.bookingId));
    const below = await belowFor(seat);
    const first = seat.personName.trim().split(/\s+/)[0];
    expect(below).toHaveTextContent(new RegExp(`Say hello to ${first}[:.]`));
    // Never the booking's free-text note or what the diver came for: those
    // stay behind the row's note count and the departure's tally.
    expect(below.querySelectorAll("p")).toHaveLength(2);
  });

  it("says nothing for a diver who never shared it", async () => {
    const seat = await firstTimerAtTheCounter();
    await seat.db
      .update(bookings)
      .set({ welcomeSharedAt: null })
      .where(eq(bookings.id, seat.bookingId));
    const below = await belowFor(seat);
    expect(below).not.toHaveTextContent("first time with us");
    expect(below).not.toHaveTextContent("Say hello");
  });
});
