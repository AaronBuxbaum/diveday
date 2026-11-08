// @vitest-environment node

import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyBookingCapability } from "../../db/booking-capabilities";
import { createBooking } from "../../db/bookings";
import type { AppDb } from "../../db/client";
import { openRecapLink } from "../../db/recap-links";
import { bookings, people, priorVisits } from "../../db/schema/index";
import { createTrip } from "../../db/trips";
import { fileScopedShopContext } from "../../test/db";
import { latestDiveDayBooking, listYourDays, openYourDay } from "./store";

/**
 * **A regular's other days, from one booking's page** (H-20261014-other-days-send-fresh, ADR
 * 20261016-fresh-link-per-booking-row). What matters most is the refusal: a
 * page reaches only its own person's days in its own shop.
 */

const APP_ORIGIN = "https://diveday.test";
vi.mock("../../lib/notifications/app-url", () => ({ publicAppUrl: () => APP_ORIGIN }));

const sent = vi.fn();
vi.mock("../../db/notifications", () => ({
  sendAndRecordNotification: (_db: unknown, notification: unknown) => {
    sent(notification);
    return Promise.resolve({ status: "sent", providerMessageId: "test" });
  },
}));

const ctx = fileScopedShopContext();
beforeEach(() => sent.mockClear());

// 2030, so the demo shop's own board (anchored to the real now) is all behind
// the clock and none of its seats belong to the people built here.
const NOW = new Date("2030-06-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

async function day(db: AppDb, shopId: string, title: string, offsetDays: number) {
  const startsAt = new Date(NOW.getTime() + offsetDays * DAY);
  const trip = await createTrip(db, {
    shopId,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 6,
    plannedDives: 2,
  });
  if (!trip) throw new Error(`trip "${title}" not created`);
  return trip;
}

async function seat(
  db: AppDb,
  shopId: string,
  tripId: string,
  email: string,
  fullName = "Sana Malik",
) {
  const outcome = await createBooking(db, { actor: "staff", shopId, tripId, fullName, email });
  if (!outcome.ok) throw new Error("expected booking to succeed");
  return outcome.bookingId;
}

/** Sana: two past dive days, the one this page is for, and two ahead. */
async function regular() {
  const { db, shop } = ctx;
  const email = "sana.days@example.com";
  const first = await seat(db, shop.id, (await day(db, shop.id, "Molasses Reef", -20)).id, email);
  const second = await seat(db, shop.id, (await day(db, shop.id, "Spiegel Grove", -10)).id, email);
  const here = await seat(db, shop.id, (await day(db, shop.id, "Today's reef", 1)).id, email);
  const later = await seat(db, shop.id, (await day(db, shop.id, "Sunrise Two-Tank", 14)).id, email);
  const sooner = await seat(db, shop.id, (await day(db, shop.id, "Night dive", 5)).id, email);
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, here));
  if (!row) throw new Error("seat missing");
  return { db, shop, email, personId: row.personId, first, second, here, later, sooner };
}

describe("listYourDays", () => {
  it("lists the person's other days: upcoming soonest first, past newest first and numbered", async () => {
    const { db, shop, here, sooner, later, first, second } = await regular();
    const days = await listYourDays(db, { shopId: shop.id, bookingId: here, now: NOW });
    expect(days.upcoming.map((d) => d.bookingId)).toEqual([sooner, later]);
    expect(days.past.map((d) => [d.bookingId, d.dayNumber])).toEqual([
      [second, 2],
      [first, 1],
    ]);
  });

  it("counts imported visits before a day into its number, and not one that did not happen", async () => {
    const { db, shop, here, first, personId } = await regular();
    const base = { shopId: shop.id, personId, importedAt: NOW };
    await db.insert(priorVisits).values([
      { ...base, visitedOn: "2029-01-05", dedupeKey: "yd-1" },
      { ...base, visitedOn: "2029-02-05", dedupeKey: "yd-2", statusLabel: "Cancelled" },
    ]);
    const days = await listYourDays(db, { shopId: shop.id, bookingId: here, now: NOW });
    expect(days.past.find((d) => d.bookingId === first)?.dayNumber).toBe(2);
  });

  it("leaves out a canceled seat and another diver's days", async () => {
    const { db, shop, here, sooner, later } = await regular();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, sooner));
    await seat(
      db,
      shop.id,
      (await day(db, shop.id, "Someone else's", 3)).id,
      "other.days@example.com",
      "Omar Haddad",
    );
    const days = await listYourDays(db, { shopId: shop.id, bookingId: here, now: NOW });
    expect(days.upcoming.map((d) => d.bookingId)).toEqual([later]);
  });

  it("numbers a day with the recap's own count: two boats on one date are one day", async () => {
    const { db, shop, here, first, second, email } = await regular();
    // An afternoon boat on the second past day's date.
    const secondStart = new Date(NOW.getTime() - 10 * DAY);
    const afternoon = await createTrip(db, {
      shopId: shop.id,
      title: "Spiegel Grove PM",
      startsAt: new Date(secondStart.getTime() + 3 * 60 * 60 * 1000),
      endsAt: new Date(secondStart.getTime() + 5 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 1,
    });
    if (!afternoon) throw new Error("trip not created");
    const pm = await seat(db, shop.id, afternoon.id, email);
    const days = await listYourDays(db, { shopId: shop.id, bookingId: here, now: NOW });
    expect(days.past.map((d) => [d.bookingId, d.dayNumber])).toEqual([
      [pm, 2],
      [second, 2],
      [first, 1],
    ]);
  });

  it("leaves out a held seat matched to this person, ahead or behind (security review r5-4, N2)", async () => {
    const { db, shop, here, sooner, later, first, second } = await regular();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: NOW, identityBookedAs: "S. M." })
      .where(inArray(bookings.id, [sooner, first]));
    const days = await listYourDays(db, { shopId: shop.id, bookingId: here, now: NOW });
    expect(days.upcoming.map((d) => d.bookingId)).toEqual([later]);
    // Nor is it counted: possibly somebody else's day, it would push this
    // person's numbers up (security review r5-4, second pass, N-b).
    expect(days.past.map((d) => [d.bookingId, d.dayNumber])).toEqual([[second, 1]]);
    expect(
      await openYourDay(db, {
        shopId: shop.id,
        fromBookingId: here,
        targetBookingId: sooner,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("lists nothing for a person with no email on file", async () => {
    const { db, shop, here, personId } = await regular();
    await db.update(people).set({ email: null }).where(eq(people.id, personId));
    expect(await listYourDays(db, { shopId: shop.id, bookingId: here, now: NOW })).toEqual({
      upcoming: [],
      past: [],
    });
  });
});

describe("openYourDay (issue #4059)", () => {
  it("refuses a booking that is not on this page's list, another diver's included", async () => {
    const { db, shop, here } = await regular();
    const stranger = await seat(
      db,
      shop.id,
      (await day(db, shop.id, "Stranger's", 3)).id,
      "stranger.days@example.com",
      "Nadia Petrov",
    );
    for (const target of [stranger, here]) {
      expect(
        await openYourDay(db, {
          shopId: shop.id,
          fromBookingId: here,
          targetBookingId: target,
          now: NOW,
        }),
      ).toBeNull();
    }
  });

  it("opens an upcoming day on that booking's own delivered trip-prep link, mailing nothing", async () => {
    const { db, shop, here, later } = await regular();
    const path = await openYourDay(db, {
      shopId: shop.id,
      fromBookingId: here,
      targetBookingId: later,
      now: NOW,
    });
    const token = path?.split("/").at(-1) ?? "";
    expect(path).toBe(`/ready/${token}`);
    const capability = await verifyBookingCapability(db, { token, purpose: "readiness", now: NOW });
    expect(capability).toMatchObject({ bookingId: later, delivered: true });
    expect(sent).not.toHaveBeenCalled();
  });

  it("opens a past day on its recap link", async () => {
    const { db, shop, here, first } = await regular();
    const path = await openYourDay(db, {
      shopId: shop.id,
      fromBookingId: here,
      targetBookingId: first,
      now: NOW,
    });
    const token = path?.split("/").at(-1) ?? "";
    expect(path).toBe(`/recap/${token}`);
    expect(await openRecapLink(db, token)).toBe(first);
  });
});

describe("latestDiveDayBooking", () => {
  it("never answers with a held seat (security review r5-4, N2)", async () => {
    const { db, shop, personId, second, first } = await regular();
    expect(
      (await latestDiveDayBooking(db, { shopId: shop.id, personId, now: NOW }))?.bookingId,
    ).toBe(second);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: NOW, identityBookedAs: "S. M." })
      .where(eq(bookings.id, second));
    expect(
      (await latestDiveDayBooking(db, { shopId: shop.id, personId, now: NOW }))?.bookingId,
    ).toBe(first);
  });
});
