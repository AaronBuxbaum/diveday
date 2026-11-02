// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listCheckInQueue } from "@/db/check-in";
import { createCertification } from "@/db/readiness";
import {
  bookings,
  certifications,
  lostItems,
  nitroxCertifications,
  people,
  trips,
} from "@/db/schema";
import { welcomeCueInputsByBooking } from "@/db/welcome-cues";
import { staffTranslator } from "@/i18n/staff-messages";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { turnAwayReasons } from "@/lib/turn-away";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();
// Unmount each test's rows: a row's links schedule React work that would
// otherwise run after the file's jsdom is gone ("window is not defined").
afterEach(cleanup);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// A blocked row carries the "Turned away" door, whose form refreshes the
// router after a send; rendered here outside an app router.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

describe("the counter's turned-away door (H-20261015-who-may-turn-someone)", () => {
  /** A blocked row offers exactly the categories its own blockers name. */
  it("offers a blocked row its own reasons, and only those", async () => {
    const seat = await firstTimerAtTheCounter();
    // A held seat (H-20260724-one-person-per-email) fails closed on identity, whatever else is on file.
    await seat.db
      .update(bookings)
      .set({ identityUnconfirmedAt: seat.now })
      .where(eq(bookings.id, seat.bookingId));
    const [row] = (await listCheckInQueue(seat.db, seat.shop.id, { now: seat.now })).filter(
      (candidate) => candidate.bookingId === seat.bookingId,
    );
    if (!row) throw new Error("the seat left the queue");
    const expected = turnAwayReasons(row.readiness);
    expect(expected).toContain("identity");
    const below = await belowFor(seat);
    expect(below).toHaveTextContent("Turn away");
    const offered = reasonsOffered(below);
    expect(offered).toEqual(expected);
    // Security F1: the matched person's blockers are not this seat's reasons.
    expect(offered.every((reason) => reason === "identity" || reason === "payment")).toBe(true);
  });

  /** dde-1 F1: the boat left with an arrived diver; the desk has no door left. */
  it("draws no door on an arrived diver once the boat has sailed, and keeps it on a booked one", async () => {
    const seat = await firstTimerAtTheCounter();
    // Blocked on something the seat itself owns, whatever is on file.
    await seat.db
      .update(bookings)
      .set({ identityUnconfirmedAt: seat.now })
      .where(eq(bookings.id, seat.bookingId));
    const sailed = { ...seat, now: new Date(seat.trip.startsAt.getTime() + 2 * HOUR_MS) };
    const [row] = (await listCheckInQueue(seat.db, seat.shop.id, { now: sailed.now })).filter(
      (candidate) => candidate.bookingId === seat.bookingId,
    );
    if (!row) throw new Error("the seat left the queue");
    expect(row.readiness.status).toBe("blocked");
    expect(reasonsOffered(await belowFor(sailed)).length).toBeGreaterThan(0);
    await seat.db
      .update(bookings)
      .set({ status: "checked_in" })
      .where(eq(bookings.id, seat.bookingId));
    expect(reasonsOffered(await belowFor(sailed))).toEqual([]);
  });

  it("says a turned-away seat was seen at the desk, with its reason", async () => {
    const seat = await firstTimerAtTheCounter();
    await seat.db
      .update(bookings)
      .set({ status: "no_show", turnedAwayReason: "card", turnedAwayAt: seat.now })
      .where(eq(bookings.id, seat.bookingId));
    const below = await belowFor(seat);
    expect(below).toHaveTextContent("Seen at the desk, turned away: card");
    // dde-2 #3: the one money door that works is the move on their row, and
    // it is a link to that door (#2907), not a sentence pointing at it.
    expect(below).toHaveTextContent("Nothing was charged or refunded.");
    const move = Array.from(below.querySelectorAll("a")).find(
      (link) => link.textContent === "Move the booking to another day",
    );
    expect(move?.getAttribute("href")).toBe(
      `/shop/${seat.shop.slug}/trips/${seat.trip.id}#move-booking-${seat.bookingId}`,
    );
    expect(below).not.toHaveTextContent("Marking someone not here");
    expect(below).not.toHaveTextContent("Open their orders");
    expect(below.querySelector('a[href*="/bookings/new/"]')).toBeNull();
  });
});

/** Layer 3 re-review (dde-3 #2, #4+#5, #7): the doors a turned-away row still has. */
describe("a turned-away row around the boat's start", () => {
  async function turnedAwaySeat() {
    const seat = await firstTimerAtTheCounter();
    const at = (minutes: number) => new Date(seat.trip.startsAt.getTime() + minutes * 60_000);
    await seat.db
      .update(bookings)
      .set({ status: "no_show", turnedAwayReason: "card", turnedAwayAt: at(-40) })
      .where(eq(bookings.id, seat.bookingId));
    return { seat, at };
  }

  async function deskAt(seat: Awaited<ReturnType<typeof firstTimerAtTheCounter>>, now: Date) {
    const desk = await buildArrivalDesk({
      db: seat.db,
      shopId: seat.shop.id,
      shopSlug: seat.shop.slug,
      tripId: seat.trip.id,
      trip: seat.trip,
      now,
      locale: "en-US",
      timeZone: seat.shop.timezone,
      t: staffTranslator("en-US"),
    });
    if (!desk) throw new Error("the boat is outside its arrivals window");
    const control = render(<div>{desk.arrival.controls.get(seat.bookingId)}</div>).container;
    const below = render(<div>{desk.arrival.below.get(seat.bookingId)}</div>).container;
    return { control, below };
  }

  const MOVE = "Move the booking to another day";
  const REMOVE = "Remove the booking and refund it by hand";

  it("keeps Undo and the move a minute before the start, and offers neither from it", async () => {
    const { seat, at } = await turnedAwaySeat();
    const before = await deskAt(seat, at(-1));
    expect(before.control).toHaveTextContent("Put back on the list");
    expect(before.below).toHaveTextContent(MOVE);
    for (const minutes of [0, 10]) {
      const after = await deskAt(seat, at(minutes));
      expect(after.control).not.toHaveTextContent("Put back on the list");
      expect(after.below).toHaveTextContent("Seen at the desk, turned away: card");
      expect(after.below).toHaveTextContent(REMOVE);
      expect(after.below).not.toHaveTextContent(MOVE);
    }
  });

  /** #7: a party's lead cannot be moved (`leads_party`), so their door is Remove. */
  it("offers a party's lead Remove, never the move", async () => {
    const { seat, at } = await turnedAwaySeat();
    const [member] = await seat.db
      .insert(people)
      .values({ shopId: seat.shop.id, fullName: "Pia Party" })
      .returning();
    if (!member) throw new Error("member insert failed");
    await seat.db.insert(bookings).values({
      bookedAs: "diver",
      shopId: seat.shop.id,
      tripId: seat.trip.id,
      personId: member.id,
      partyLeadBookingId: seat.bookingId,
    });
    const { below } = await deskAt(seat, at(-30));
    expect(below).toHaveTextContent(REMOVE);
    expect(below).not.toHaveTextContent(MOVE);
  });
});

function reasonsOffered(below: HTMLElement) {
  return [...below.querySelectorAll<HTMLInputElement>('input[name="reason"]')].map(
    (input) => input.value,
  );
}

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
