import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { setBookingPayment } from "@/db/payments";
import {
  activityEvents,
  bookings,
  notificationDeliveries,
  rollCallEvents,
  trips,
} from "@/db/schema";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * **A diver marked aboard a boat that has left stays on the roster** (H-20261015-aboard-diver-removal-at).
 * An owner, who may refund, is refused all the same: no cancellation, no
 * refund, no email, no trail line, and the row says why. `cancelBooking`'s own
 * contract is `src/db/aboard-at-sea.test.ts`.
 */

const ctx = fileScopedShopContext();

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
// The money seam, so a refusal is checked where the refund would have gone.
vi.mock("@/db/refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/refunds")>();
  return { ...actual, refundBookingOnCancellation: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { refundBookingOnCancellation } = await import("@/db/refunds");
const { removeBookingAction } = await import("./roster-seating-actions");

/** A paid, booked seat on a departure that left two hours ago, boarded at the dock. */
async function paidSeatAboardAtSea(db: AppDb, shopId: string, recorder: string) {
  const [seat] = await db
    .select({ id: bookings.id, tripId: bookings.tripId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.shopId, shopId), eq(bookings.status, "booked"), isNull(trips.courseId)))
    .limit(1);
  if (!seat) throw new Error("seeded shop has no booked seat");
  await setBookingPayment(db, {
    shopId,
    bookingId: seat.id,
    status: "paid",
    amountCents: 12_000,
    currency: "usd",
  });
  const departed = new Date(nowMs() - 2 * 60 * 60 * 1000);
  await db
    .update(trips)
    .set({ startsAt: departed, endsAt: new Date(departed.getTime() + 4 * 60 * 60 * 1000) })
    .where(eq(trips.id, seat.tripId));
  await db.insert(rollCallEvents).values({
    shopId,
    tripId: seat.tripId,
    bookingId: seat.id,
    recordedByPersonId: recorder,
    status: "boarded",
    occurredAt: new Date(departed.getTime() + 5 * 60 * 1000),
  });
  return seat;
}

describe("removing a diver marked aboard at sea", () => {
  it("refuses an owner, moves no money and tells nobody the seat was cancelled", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    vi.mocked(requireShopSurface).mockResolvedValue({
      session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
      db,
      shop,
    } as never);
    const seat = await paidSeatAboardAtSea(db, shop.id, owner);
    const formData = new FormData();
    formData.set("bookingId", seat.id);

    const to = await redirectedTo(() => removeBookingAction(shop.slug, seat.tripId, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/trips/${seat.tripId}?notice=booking-remove-aboard&bid=${seat.id}`,
    );
    const [row] = await db.select().from(bookings).where(eq(bookings.id, seat.id));
    expect(row?.status).toBe("booked");
    expect(refundBookingOnCancellation).not.toHaveBeenCalled();
    expect(
      await db
        .select({ id: activityEvents.id })
        .from(activityEvents)
        .where(
          and(eq(activityEvents.bookingId, seat.id), eq(activityEvents.code, "booking_removed")),
        ),
    ).toEqual([]);
    expect(
      await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.bookingId, seat.id)),
    ).toEqual([]);
  });
});
