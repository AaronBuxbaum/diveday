import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { setBookingPayment } from "@/db/payments";
import { bookings, tripRequirements, trips } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * Two different gates live in this file, and the line between them is the point:
 *
 * - `requireTripConfig` — what the dive *is* and who it admits. A captain runs
 *   the boat but does not get to lower the certification a trip demands, which
 *   is a safety gate, not a preference.
 * - `canPersonRefund` inside `removeBookingAction` — a captain *may* free a seat
 *   (roster work) but the auto-refund must not fire under a role that cannot
 *   move money; the paid booking is handed up to an owner/manager instead.
 *
 * Neither `upsertTripRequirements` nor `setTripStatus` re-checks anything below
 * this layer, so the assertions look at the rows afterwards, not just the notice.
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
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
// The money seam. Mocked so a refusal can be checked where the refund would
// actually have been issued, rather than inferred from a notice string.
vi.mock("@/db/refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/refunds")>();
  return { ...actual, refundBookingOnCancellation: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { refundBookingOnCancellation } = await import("@/db/refunds");
const { removeBookingAction, reinstateTripAction, saveRequirementsAction } = await import(
  "./actions"
);

/**
 * A seeded ordinary charter — not a course session, whose rules are frozen —
 * that already demands a certification and a waiver. Picking a trip with
 * requirements is what makes "the row did not change" mean anything: against a
 * trip with no requirements row, every such assertion would pass vacuously.
 */
async function seededTripId(db: AppDb, shopId: string): Promise<string> {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .innerJoin(tripRequirements, eq(tripRequirements.tripId, trips.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        isNull(trips.courseId),
        isNotNull(tripRequirements.minimumCertificationLevel),
        eq(tripRequirements.requiresWaiver, true),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!trip) throw new Error("seeded shop has no gated non-course trip");
  return trip.id;
}

async function requirementsOf(db: AppDb, tripId: string) {
  const [row] = await db.select().from(tripRequirements).where(eq(tripRequirements.tripId, tripId));
  if (!row) throw new Error("trip requirements vanished");
  return row;
}

async function bookingRow(db: AppDb, bookingId: string) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!row) throw new Error("booking vanished");
  return row;
}

/** A booked seat on `tripId`, marked paid so a refund is genuinely at stake. */
async function paidBookingId(db: AppDb, shopId: string, tripId: string): Promise<string> {
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

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  return {
    db,
    shop,
    tripId: await seededTripId(db, shop.id),
    owner: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
    captain: await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL),
  };
}

function signIn(shop: { id: string; slug: string }, personId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
}

function requirementsForm(minimumCertificationLevel: string): FormData {
  const formData = new FormData();
  formData.set("minimumCertificationLevel", minimumCertificationLevel);
  formData.set("requiresWaiver", "on");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setting what a trip admits", () => {
  it("refuses a captain clearing the certification the trip demands", async () => {
    const { db, shop, tripId, captain } = await context();
    const before = await requirementsOf(db, tripId);
    signIn(shop, captain);
    // An empty select posts as `""`, which the action reads as "no C-card
    // required" — the cheapest possible forged post, and a safety gate.
    const to = await redirectedTo(() =>
      saveRequirementsAction(shop.slug, tripId, requirementsForm("")),
    );

    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=not-authorized`);
    expect(before.minimumCertificationLevel).not.toBeNull();
    expect((await requirementsOf(db, tripId)).minimumCertificationLevel).toBe(
      before.minimumCertificationLevel,
    );
  });

  it("refuses a captain dropping the waiver requirement", async () => {
    // An unticked checkbox is simply an absent field, so leaving `requiresWaiver`
    // out is all it takes to ask for a trip that needs no signed release.
    const { db, shop, tripId, captain } = await context();
    const before = await requirementsOf(db, tripId);
    signIn(shop, captain);
    const formData = new FormData();
    formData.set("minimumCertificationLevel", before.minimumCertificationLevel ?? "");

    const to = await redirectedTo(() => saveRequirementsAction(shop.slug, tripId, formData));

    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=not-authorized`);
    expect((await requirementsOf(db, tripId)).requiresWaiver).toBe(true);
  });

  it("lets an owner set the certification the trip demands", async () => {
    const { db, shop, tripId, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveRequirementsAction(shop.slug, tripId, requirementsForm("")),
    );

    // Nothing about the card ladder is demanded any more, so no booked diver
    // carries a certification blocker and the save settles on the plain notice.
    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=requirements`);
    expect((await requirementsOf(db, tripId))?.minimumCertificationLevel).toBeNull();
  });

  /**
   * **Tightening a gate under a roster that is already booked.** Readiness is
   * computed live, so those divers turn up blocked on Today, the board, the
   * roster, and the manifest the moment this saves — nothing here has to
   * re-check them. What was missing is that the staffer who tightened it walked
   * away not knowing, and found out when a diver did. It stays a notice, never
   * a refusal: a shop may legitimately tighten a gate and then work the roster.
   */
  it("tells an owner how many booked divers a tightened requirement just blocked", async () => {
    const { db, shop, tripId, owner } = await context();
    signIn(shop, owner);

    const to = await redirectedTo(() =>
      saveRequirementsAction(shop.slug, tripId, requirementsForm("rescue")),
    );

    expect(to).toMatch(
      new RegExp(
        `^/shop/${shop.slug}/trips/${tripId}\\?notice=requirements-blocking&count=[1-9]\\d*$`,
      ),
    );
    // Saved regardless — the notice never stands in the way of the write.
    expect((await requirementsOf(db, tripId))?.minimumCertificationLevel).toBe("rescue");
  });
});

describe("putting a cancelled trip back on the board", () => {
  it("refuses a captain — cancelling today's charter is the crew's call, un-cancelling is not", async () => {
    const { db, shop, tripId, captain } = await context();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    signIn(shop, captain);

    const to = await redirectedTo(() => reinstateTripAction(shop.slug, tripId));

    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=not-authorized`);
    const [after] = await db
      .select({ status: trips.status })
      .from(trips)
      .where(eq(trips.id, tripId));
    expect(after?.status).toBe("cancelled");
  });

  it("lets an owner reinstate it", async () => {
    const { db, shop, tripId, owner } = await context();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    signIn(shop, owner);

    const to = await redirectedTo(() => reinstateTripAction(shop.slug, tripId));

    expect(to).toBe(`/shop/${shop.slug}/trips/${tripId}?notice=reinstated`);
    const [after] = await db
      .select({ status: trips.status })
      .from(trips)
      .where(eq(trips.id, tripId));
    expect(after?.status).toBe("scheduled");
  });
});

describe("removing a paid diver from the manifest", () => {
  it("lets a captain free the seat but never issues the refund — that goes to an owner", async () => {
    const { db, shop, tripId, captain } = await context();
    const bookingId = await paidBookingId(db, shop.id, tripId);
    signIn(shop, captain);
    const formData = new FormData();
    formData.set("bookingId", bookingId);

    const to = await redirectedTo(() => removeBookingAction(shop.slug, tripId, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/trips/${tripId}/guests?notice=booking-removed-refund-owner&bid=${bookingId}`,
    );
    // The seat really is free — this is not a blanket refusal of the action.
    expect((await bookingRow(db, bookingId)).status).toBe("cancelled");
    // And no money moved under a role that may not move it.
    expect(refundBookingOnCancellation).not.toHaveBeenCalled();
  });

  it("runs the refund when an owner removes the same booking", async () => {
    const { db, shop, tripId, owner } = await context();
    const bookingId = await paidBookingId(db, shop.id, tripId);
    vi.mocked(refundBookingOnCancellation).mockResolvedValue({ status: "refunded" } as never);
    signIn(shop, owner);
    const formData = new FormData();
    formData.set("bookingId", bookingId);

    const to = await redirectedTo(() => removeBookingAction(shop.slug, tripId, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/trips/${tripId}/guests?notice=booking-removed-refunded&bid=${bookingId}`,
    );
    expect(refundBookingOnCancellation).toHaveBeenCalledWith(expect.anything(), {
      shopId: shop.id,
      bookingId,
    });
  });
});
