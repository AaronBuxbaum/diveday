// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { listCheckInQueue } from "@/db/check-in";
import { createCertification } from "@/db/readiness";
import { bookings, certifications, lostItems, nitroxCertifications, trips } from "@/db/schema";
import { welcomeCueInputsByBooking } from "@/db/welcome-cues";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { buildArrivalDesk } = await import("./arrival-desk");

/** A seat at the counter whose diver has never been on one of this shop's boats. */
async function firstTimerAtTheCounter() {
  const { db, shop } = ctx;
  const now = nowDate();
  const queue = await listCheckInQueue(db, shop.id, { now });
  for (const row of queue) {
    if (row.bookingStatus !== "booked") continue;
    const inputs = await welcomeCueInputsByBooking(db, shop.id, row.tripId, now);
    if (inputs.get(row.bookingId)?.lastDivedAt === null) {
      const [trip] = await db.select().from(trips).where(eq(trips.id, row.tripId));
      if (trip)
        return {
          db,
          shop,
          now,
          trip,
          bookingId: row.bookingId,
          personId: row.personId,
          personName: row.personName,
        };
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
    expect(await belowFor(seat)).toHaveTextContent("First dive with us");
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

  it("ends the dock line with the diver's own choice, and never the booking's free text", async () => {
    const seat = await firstTimerAtTheCounter();
    await seat.db
      .update(bookings)
      .set({
        welcomeSharedAt: seat.now,
        welcomeHello: "nervous",
        hotelPickupLocation: "Panic attacks underwater; on sertraline.",
      })
      .where(eq(bookings.id, seat.bookingId));
    const below = await belowFor(seat);
    expect(below).toHaveTextContent("A little nervous.");
    expect(below).not.toHaveTextContent(/panic|sertraline/i);
    expect(below.querySelectorAll("p")).toHaveLength(2);
  });

  it("shows no choice when the consent is gone, even if the row still holds one", async () => {
    const seat = await firstTimerAtTheCounter();
    await seat.db
      .update(bookings)
      .set({ welcomeSharedAt: null, welcomeHello: "celebrating" })
      .where(eq(bookings.id, seat.bookingId));
    const below = await belowFor(seat);
    expect(below).not.toHaveTextContent("Celebrating");
    expect(below).not.toHaveTextContent("Say hello");
  });

  /**
   * **A card a staffer typed and nobody has verified is what the diver says**
   * (dive-domain review of the demo layer). It carries no self-declared stamp,
   * and the line used to read it as a plain "Open Water" in muted text: a
   * checked card, to the crew greeting them. Nitrox never rides the line.
   */
  it("says a pending card a staffer typed is the diver's word, in the warning tone", async () => {
    const seat = await firstTimerAtTheCounter();
    await seat.db
      .update(bookings)
      .set({ welcomeSharedAt: seat.now })
      .where(eq(bookings.id, seat.bookingId));
    await seat.db
      .update(certifications)
      .set({ deletedAt: seat.now })
      .where(eq(certifications.personId, seat.personId));
    await createCertification(seat.db, {
      shopId: seat.shop.id,
      personId: seat.personId,
      agency: "padi",
      level: "open_water",
      identifier: "OW-DOCK-1",
    });
    await seat.db.insert(nitroxCertifications).values({
      shopId: seat.shop.id,
      personId: seat.personId,
      agency: "padi",
      identifier: "EAN-DOCK-1",
      status: "verified",
    });
    const below = await belowFor(seat);
    const first = seat.personName.trim().split(/\s+/)[0];
    const line = [...below.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Say hello"),
    );
    expect(line).toHaveTextContent(`Say hello to ${first}: says Open Water.`);
    expect(line).not.toHaveTextContent(/nitrox/i);
    expect(line?.className).toContain("text-warning-strong");
  });

  it("says nothing for a diver who never shared it", async () => {
    const seat = await firstTimerAtTheCounter();
    await seat.db
      .update(bookings)
      .set({ welcomeSharedAt: null })
      .where(eq(bookings.id, seat.bookingId));
    const below = await belowFor(seat);
    expect(below).not.toHaveTextContent("First dive with us");
    expect(below).not.toHaveTextContent("Say hello");
  });
});

describe("the paper pass on an arrived row (fourth review, item 48)", () => {
  /**
   * Two controls at the row's end broke a short name over two lines at 390.
   * The pass now sits under the name; the row's end holds "Checked in" alone.
   */
  it("puts Print a pass under a cleared, checked-in diver's name, not beside Checked in", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const queue = await listCheckInQueue(db, shop.id, { now });
    const row = queue.find((r) => r.bookingStatus === "booked" && r.readiness.status === "ready");
    if (!row) throw new Error("no cleared diver is booked inside the arrivals window");
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, row.bookingId));
    const [trip] = await db.select().from(trips).where(eq(trips.id, row.tripId));
    if (!trip) throw new Error("the trip is gone");
    const desk = await buildArrivalDesk({
      db,
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      trip,
      now,
      locale: "en-US",
      timeZone: shop.timezone,
      t: staffTranslator("en-US"),
    });
    if (!desk) throw new Error("the boat is outside its arrivals window");
    const below = render(<div>{desk.arrival.below.get(row.bookingId)}</div>).container;
    expect(below).toHaveTextContent("Print a pass");
    // The row's end is the undo tap alone (a client island, so read its
    // element rather than mounting it without a router).
    const end = desk.arrival.controls.get(row.bookingId) as ReactElement<{ checkedIn?: boolean }>;
    expect(isValidElement(end)).toBe(true);
    expect(end.type).not.toBe("span");
    expect(end.props.checkedIn).toBe(true);
  });
});

/**
 * **A found item meets its owner at the counter** (fifth loop, item 7): the
 * crew tied it to their seat on an earlier boat, and today they are here.
 */
describe("the counter's found-item line", () => {
  it("names what is waiting for the diver, and nothing once it went home", async () => {
    const seat = await firstTimerAtTheCounter();
    const [earlier] = await seat.db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, seat.shop.id))
      .limit(1);
    if (!earlier) throw new Error("no departure to have found it on");
    await seat.db.insert(lostItems).values({
      shopId: seat.shop.id,
      tripId: earlier.id,
      personId: seat.personId,
      bookingId: seat.bookingId,
      description: "Blue mask, black strap",
    });
    expect(await belowFor(seat)).toHaveTextContent("In lost and found: Blue mask, black strap");

    await seat.db
      .update(lostItems)
      .set({ status: "returned", resolvedAt: seat.now })
      .where(eq(lostItems.personId, seat.personId));
    expect(await belowFor(seat)).not.toHaveTextContent("In lost and found");
  });
});
