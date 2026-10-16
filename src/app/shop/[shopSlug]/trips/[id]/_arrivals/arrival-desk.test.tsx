// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { listCheckInQueue } from "@/db/check-in";
import { createCertification } from "@/db/readiness";
import { bookings, certifications, nitroxCertifications, trips } from "@/db/schema";
import { welcomeCueInputsByBooking } from "@/db/welcome-cues";
import { staffTranslator } from "@/i18n/staff-messages";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { turnAwayReasons } from "@/lib/turn-away";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

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
    expect(below).not.toHaveTextContent("first time with us");
    expect(below).not.toHaveTextContent("Say hello");
  });
});

describe("the counter's turned-away door (H-124)", () => {
  /** A blocked row offers exactly the categories its own blockers name. */
  it("offers a blocked row its own reasons, and only those", async () => {
    const seat = await firstTimerAtTheCounter();
    // A held seat (H-13) fails closed on identity, whatever else is on file.
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
    expect(below).toHaveTextContent("Turned away");
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
    // dde-2 #3: the one money door that works is the move on their row.
    expect(below).toHaveTextContent(
      "Nothing was charged or refunded. Open their row to move the booking to another day.",
    );
    expect(below).not.toHaveTextContent("Marking someone not here");
    expect(below).not.toHaveTextContent("Open their orders");
    expect(below.querySelector('a[href*="/bookings/new/"]')).toBeNull();
  });
});

function reasonsOffered(below: HTMLElement) {
  return [...below.querySelectorAll<HTMLInputElement>('input[name="reason"]')].map(
    (input) => input.value,
  );
}
