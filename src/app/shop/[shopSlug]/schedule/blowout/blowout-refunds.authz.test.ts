import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingParty } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { setBookingPayment } from "@/db/payments";
import { trips } from "@/db/schema";
import { createTrip, createTripSeries, getTripWithBooked } from "@/db/trips";
import { updateSeriesCadence } from "@/db/trips-series";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { weekdaySetFrom } from "@/lib/recurrence";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **Calling a departure off is the crew's; the refunds it triggers are not**
 * (H-20261013-call-off-queues-refunds, issue #2459). Four doors call departures off and the same rule holds
 * at each: a caller without the refund right (`canRefund`, H-20260724-staff-role-reach) cancels and
 * tells the divers but leaves every capture where it is, and a refund holder
 * sends it back. The seam asserted is the Stripe-bound refund call itself, not
 * a notice string.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/db/refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/refunds")>();
  return {
    ...actual,
    refundBookingOnShopCancellation: vi.fn(async () => ({
      status: "refunded" as const,
      amountCents: 12_000,
    })),
    refundBookingsForShopCancelledTrip: vi.fn(async () => new Map()),
  };
});

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { refundBookingOnShopCancellation, refundBookingsForShopCancelledTrip } = await import(
  "@/db/refunds"
);
const { callBlowoutAction, releaseBlowoutRefundsAction } = await import("./[tripId]/actions");
const { callDayBlowoutAction } = await import("./day/[date]/actions");
const { cancelOffCadenceSeriesAction, cancelSeriesAction } = await import(
  "../../trips/[id]/series-actions"
);

const SEEDED_INSTRUCTOR_EMAIL = "marcus@demo.invalid";
const HOUR = 60 * 60 * 1_000;

beforeEach(() => {
  vi.stubEnv("APP_HOST", "https://diveday.example");
  vi.mocked(refundBookingOnShopCancellation).mockClear();
  vi.mocked(refundBookingsForShopCancelledTrip).mockClear();
});

/** Sign in as `email`'s person; the real gates re-read their live roles from the database. */
async function signInAs(email: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, email);
  const session = staffSession({ shopId: shop.id, shopSlug: shop.slug, personId });
  vi.mocked(requireShopSurface).mockImplementation(async (_shopSlug, options) => {
    if (options?.allow && !(await options.allow(db, shop.id, personId))) {
      throw new Error(
        `REDIRECT:${noticeUrl(
          shopPath(shop.slug, ...(options.refusal.landing ?? [])),
          options.refusal.notice,
        )}`,
      );
    }
    return { session, db, shop } as never;
  });
  return personId;
}

/** One card-paid diver on `tripId`: money is genuinely at stake. */
async function paidDiver(db: AppDb, shopId: string, tripId: string, name: string) {
  const party = await createBookingParty(db, [
    {
      actor: "staff" as const,
      shopId,
      tripId,
      fullName: name,
      email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
    },
  ]);
  if (!party.ok) throw new Error("could not book the diver");
  const bookingId = party.bookings[0]?.bookingId as string;
  await setBookingPayment(db, {
    shopId,
    bookingId,
    status: "paid",
    amountCents: 12_000,
    currency: "usd",
    provider: "stripe",
    providerRef: `cs_${bookingId}`,
  });
  return bookingId;
}

async function tomorrowsTrip(title = "Weather Charter") {
  const { db, shop } = ctx;
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId: shop.id,
    title,
    startsAt: new Date(now.getTime() + 20 * HOUR),
    endsAt: new Date(now.getTime() + 24 * HOUR),
    capacity: 12,
    plannedDives: 2,
  });
  if (!trip) throw new Error("trip not created");
  await paidDiver(db, shop.id, trip.id, "Ada Storm");
  return trip;
}

const statusOf = async (tripId: string) =>
  (await getTripWithBooked(ctx.db, ctx.shop.id, tripId))?.status;

describe("the single-departure blow-out", () => {
  it.each([
    ["an owner", SEEDED_OWNER_EMAIL, true],
    ["a captain", SEEDED_CAPTAIN_EMAIL, false],
    ["an instructor", SEEDED_INSTRUCTOR_EMAIL, false],
  ])("%s cancels it, and refunds %s", async (_who, email, refunds) => {
    const trip = await tomorrowsTrip();
    await signInAs(email);
    const to = await redirectedTo(() => callBlowoutAction(ctx.shop.slug, trip.id));
    expect(to).toContain("notice=called");
    expect(await statusOf(trip.id)).toBe("cancelled");
    expect(vi.mocked(refundBookingOnShopCancellation).mock.calls.length > 0).toBe(refunds);
  });
});

describe("the day weather call", () => {
  const callDay = async (email: string, tripId: string) => {
    const date = calendarDateInTimezone(
      (await getTripWithBooked(ctx.db, ctx.shop.id, tripId))?.startsAt as Date,
      ctx.shop.timezone,
    );
    await signInAs(email);
    const form = new FormData();
    form.append("tripId", tripId);
    return redirectedTo(() => callDayBlowoutAction(ctx.shop.slug, date, form));
  };

  it("lets a captain call the day but leaves the money for a refund holder", async () => {
    const trip = await tomorrowsTrip();
    const to = await callDay(SEEDED_CAPTAIN_EMAIL, trip.id);
    expect(to).toContain("notice=day-called");
    expect(await statusOf(trip.id)).toBe("cancelled");
    expect(refundBookingOnShopCancellation).not.toHaveBeenCalled();
  });

  it("refunds when an owner calls the day", async () => {
    const trip = await tomorrowsTrip();
    await callDay(SEEDED_OWNER_EMAIL, trip.id);
    expect(await statusOf(trip.id)).toBe("cancelled");
    expect(refundBookingOnShopCancellation).toHaveBeenCalledTimes(1);
  });

  it("refuses an instructor outright, and nothing is cancelled or refunded", async () => {
    const trip = await tomorrowsTrip();
    const to = await callDay(SEEDED_INSTRUCTOR_EMAIL, trip.id);
    expect(to).toContain("notice=day-blowout-not-authorized");
    expect(await statusOf(trip.id)).toBe("scheduled");
    expect(refundBookingOnShopCancellation).not.toHaveBeenCalled();
  });
});

describe("the run-wide and narrowing cancels", () => {
  /** A weekly run on tomorrow's weekday and the one after, one paid diver on its first date. */
  async function run() {
    const { db, shop } = ctx;
    const tomorrow = new Date(nowDate().getTime() + 24 * HOUR);
    const date = calendarDateInTimezone(tomorrow, shop.timezone);
    const [year, month, day] = date.split("-").map(Number);
    const startsAt = wallTimeToUtc({ year, month, day, hour: 23, minute: 0 }, shop.timezone);
    const endsAt = new Date(startsAt.getTime() + 3 * HOUR);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const dayAfter = (weekday + 2) % 7;
    const series = await createTripSeries(db, {
      shopId: shop.id,
      title: "Weekly Reef",
      capacity: 8,
      plannedDives: 2,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([weekday, dayAfter]),
      anchorDate: date,
      endsOn: null,
      timeZone: shop.timezone,
      template: { startsAt, endsAt },
    });
    const [first] = series?.trips ?? [];
    if (!series || !first) throw new Error("series not created");
    await paidDiver(db, shop.id, first.id, "Ben Gale");
    return { series, first, weekday };
  }

  it.each([
    ["an owner", SEEDED_OWNER_EMAIL, true],
    ["an instructor", SEEDED_INSTRUCTOR_EMAIL, false],
  ])("%s cancelling every upcoming date refunds %s", async (_who, email, refunds) => {
    const { series, first } = await run();
    await signInAs(email);
    const to = await redirectedTo(() =>
      cancelSeriesAction(ctx.shop.slug, first.id, series.series.id),
    );
    expect(to).toContain("notice=series-cancelled");
    expect(await statusOf(first.id)).toBe("cancelled");
    expect(vi.mocked(refundBookingOnShopCancellation).mock.calls.length > 0).toBe(refunds);
  });

  it("refuses a captain the run-wide cancel, and nothing moves", async () => {
    const { series, first } = await run();
    await signInAs(SEEDED_CAPTAIN_EMAIL);
    const to = await redirectedTo(() =>
      cancelSeriesAction(ctx.shop.slug, first.id, series.series.id),
    );
    expect(to).toContain("notice=not-authorized");
    expect(await statusOf(first.id)).toBe("scheduled");
    expect(refundBookingOnShopCancellation).not.toHaveBeenCalled();
  });

  describe("taking the dates a narrowed cadence drops off the board", () => {
    async function narrowed() {
      const { series, first, weekday } = await run();
      // Drop the first date's weekday, so its paid diver sits on a dropped date.
      await updateSeriesCadence(ctx.db, ctx.shop.id, series.series.id, {
        intervalWeeks: 1,
        weekdays: weekdaySetFrom([(weekday + 2) % 7]),
        endsOn: null,
      });
      return { series, first };
    }

    it.each([
      ["an owner", SEEDED_OWNER_EMAIL, true],
      ["an instructor", SEEDED_INSTRUCTOR_EMAIL, false],
    ])("%s refunds %s", async (_who, email, refunds) => {
      const { series, first } = await narrowed();
      await signInAs(email);
      const to = await redirectedTo(() =>
        cancelOffCadenceSeriesAction(ctx.shop.slug, first.id, series.series.id),
      );
      expect(to).toContain("notice=series-off-cadence-cancelled");
      expect(await statusOf(first.id)).toBe("cancelled");
      expect(vi.mocked(refundBookingOnShopCancellation).mock.calls.length > 0).toBe(refunds);
    });

    it("refuses a captain, and nothing moves", async () => {
      const { series, first } = await narrowed();
      await signInAs(SEEDED_CAPTAIN_EMAIL);
      const to = await redirectedTo(() =>
        cancelOffCadenceSeriesAction(ctx.shop.slug, first.id, series.series.id),
      );
      expect(to).toContain("notice=not-authorized");
      expect(await statusOf(first.id)).toBe("scheduled");
    });
  });
});

describe("releasing the refunds a call-off left queued", () => {
  it("sends them back for an owner on a canceled departure", async () => {
    const trip = await tomorrowsTrip();
    await signInAs(SEEDED_CAPTAIN_EMAIL);
    await redirectedTo(() => callBlowoutAction(ctx.shop.slug, trip.id));
    expect(refundBookingOnShopCancellation).not.toHaveBeenCalled();

    await signInAs(SEEDED_OWNER_EMAIL);
    const to = await redirectedTo(() => releaseBlowoutRefundsAction(ctx.shop.slug, trip.id));
    expect(to).toContain("notice=refunds-released");
    expect(refundBookingsForShopCancelledTrip).toHaveBeenCalledWith(expect.anything(), {
      shopId: ctx.shop.id,
      tripId: trip.id,
    });
  });

  it.each([
    ["a captain", SEEDED_CAPTAIN_EMAIL],
    ["an instructor", SEEDED_INSTRUCTOR_EMAIL],
  ])("refuses %s", async (_who, email) => {
    const trip = await tomorrowsTrip();
    await signInAs(SEEDED_OWNER_EMAIL);
    await redirectedTo(() => callBlowoutAction(ctx.shop.slug, trip.id));
    vi.mocked(refundBookingOnShopCancellation).mockClear();
    await signInAs(email);
    const to = await redirectedTo(() => releaseBlowoutRefundsAction(ctx.shop.slug, trip.id));
    expect(to).toContain("notice=refund-not-authorized");
    expect(refundBookingsForShopCancelledTrip).not.toHaveBeenCalled();
  });

  it("never reaches a departure that is still on the board, even for an owner", async () => {
    const trip = await tomorrowsTrip();
    await signInAs(SEEDED_OWNER_EMAIL);
    const to = await redirectedTo(() => releaseBlowoutRefundsAction(ctx.shop.slug, trip.id));
    expect(to).toContain("notice=error");
    expect(refundBookingsForShopCancelledTrip).not.toHaveBeenCalled();
    expect(await statusOf(trip.id)).toBe("scheduled");
  });

  it("never reaches a canceled departure that has no blow-out record, even for an owner", async () => {
    // Canceled the ordinary way (a trip cancel, not a call-off): releasing would
    // refund every seat of a departure this page never queued anything for.
    const trip = await tomorrowsTrip();
    await ctx.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    await signInAs(SEEDED_OWNER_EMAIL);
    const to = await redirectedTo(() => releaseBlowoutRefundsAction(ctx.shop.slug, trip.id));
    expect(to).toContain("notice=error");
    expect(refundBookingsForShopCancelledTrip).not.toHaveBeenCalled();
  });

  it("never reaches another shop's departure", async () => {
    await signInAs(SEEDED_OWNER_EMAIL);
    const to = await redirectedTo(() =>
      releaseBlowoutRefundsAction(ctx.shop.slug, "00000000-0000-4000-8000-000000000000"),
    );
    expect(to).toContain("notice=error");
    expect(refundBookingsForShopCancelledTrip).not.toHaveBeenCalled();
  });
});
