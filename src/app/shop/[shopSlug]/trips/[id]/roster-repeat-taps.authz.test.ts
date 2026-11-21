import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { setBookingPayment } from "@/db/payments";
import { bookings, cards, courses, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips-live";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";
import { shopClock } from "../../../../../features/day/shop-clock";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/** Repeat taps on roster buttons: the second one must read as a calm repeat, not a failure or a second event. */

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
vi.mock("../../../../../features/accounts/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/db/refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/refunds")>();
  return { ...actual, refundBookingOnCancellation: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("../../../../../features/accounts/session");
const { refundBookingOnCancellation } = await import("@/db/refunds");
const { trackEvent } = await import("@/lib/analytics");
const { removeBookingAction } = await import("./roster-seating-actions");
const { certifyDiverFromRosterAction } = await import("./course-actions");

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, shop, owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL) };
}

function signIn(shop: (typeof ctx)["shop"], personId: string) {
  const { db } = ctx;
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
    return { session, db, shop, clock: shopClock(shop) };
  });
}

describe("a second tap on Certify", () => {
  async function courseSeat(db: (typeof ctx)["db"], shopId: string) {
    const [seat] = await db
      .select({
        tripId: trips.id,
        courseId: trips.courseId,
        bookingId: bookings.id,
        personId: bookings.personId,
      })
      .from(trips)
      .innerJoin(bookings, and(eq(bookings.tripId, trips.id), eq(bookings.status, "booked")))
      // A seat the roster's Certify can certify: a certifying course's diver
      // whose identity is confirmed, picked in a fixed order. An unordered
      // pick could land on an intro course or a passenger under load, and the
      // second tap then read as a failure (flaked in a full run, 2026-11-17).
      .innerJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.isIntroCourse, false)))
      .where(
        and(
          eq(trips.shopId, shopId),
          isNotNull(trips.courseId),
          liveTrip(),
          eq(bookings.participantType, "diver"),
          isNull(bookings.identityUnconfirmedAt),
        ),
      )
      .orderBy(asc(trips.startsAt), asc(bookings.id))
      .limit(1);
    if (!seat?.courseId) throw new Error("seeded shop has no booked course session");
    return { ...seat, courseId: seat.courseId };
  }

  it("says the diver already holds the level, and writes no second card", async () => {
    const { db, shop, owner } = await context();
    const seat = await courseSeat(db, shop.id);
    signIn(shop, owner);
    const post = () => {
      const formData = new FormData();
      formData.set("bookingId", seat.bookingId);
      formData.set("personId", seat.personId);
      formData.set("award", "open_water");
      return redirectedTo(() => certifyDiverFromRosterAction(shop.slug, seat.tripId, formData));
    };
    await post();
    const held = async () =>
      (
        await db
          .select({ id: cards.id })
          .from(cards)
          .where(and(eq(cards.kind, "level"), eq(cards.personId, seat.personId)))
      ).length;
    const before = await held();

    const to = await post();

    expect(to).toContain("notice=already-certified");
    expect(await held()).toBe(before);
  });

  it("still refuses with the failure notice when the diver does not hold the level", async () => {
    const { db, shop, owner } = await context();
    const seat = await courseSeat(db, shop.id);
    await db.update(courses).set({ isIntroCourse: true }).where(eq(courses.id, seat.courseId));
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("bookingId", seat.bookingId);
    formData.set("personId", seat.personId);
    formData.set("award", "open_water");

    const to = await redirectedTo(() =>
      certifyDiverFromRosterAction(shop.slug, seat.tripId, formData),
    );

    expect(to).toContain("notice=certify-failed");
  });
});

describe("removing a paid diver twice", () => {
  async function paidBookingId(db: (typeof ctx)["db"], shopId: string, tripId: string) {
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, tripId), eq(bookings.status, "booked")))
      .limit(1);
    if (!booking) throw new Error("seeded trip has no active booking");
    await setBookingPayment(db, {
      shopId,
      bookingId: booking.id,
      status: "paid",
      amountCents: 12_000,
      currency: "usd",
    });
    return booking.id;
  }

  it("counts the cancellation once when the same removal is submitted twice", async () => {
    const { db, shop, owner } = await context();
    const [{ tripId }] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.status, "booked"))
      .limit(1);
    const bookingId = await paidBookingId(db, shop.id, tripId);
    vi.mocked(refundBookingOnCancellation).mockResolvedValue({ status: "refunded" } as never);
    vi.mocked(trackEvent).mockClear();
    signIn(shop, owner);
    const post = () => {
      const formData = new FormData();
      formData.set("bookingId", bookingId);
      return redirectedTo(() => removeBookingAction(shop.slug, tripId, formData));
    };

    await post();
    await post();

    const cancelled = vi
      .mocked(trackEvent)
      .mock.calls.filter(([event]) => event.name === "booking_cancelled");
    expect(cancelled).toHaveLength(1);
  });
});
