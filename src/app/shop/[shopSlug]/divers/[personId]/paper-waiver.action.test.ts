import { and, eq, gte, isNull, ne } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { bookings, trips, waiverRecords } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

/**
 * "Mark signed on paper", from the diver's own record.
 *
 * This is the third door onto `recordInPersonWaiver` (the roster and the
 * check-in queue are the other two) and the only one that is scoped to a
 * *person* rather than to a departure — which is exactly what makes the seat it
 * files against something the server has to decide rather than accept. The
 * tests below are about that decision: the record lands on this diver's own
 * next boat, a submitted id that is somebody else's is refused outright, and
 * the medical attestation is still required at the counter it was required at
 * everywhere else (H-01/H-03; `recordInPersonWaiver`, src/db/waivers.ts).
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

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { markWaiverInPersonAction } = await import("./actions");

/**
 * A seeded diver who still owes a signature and has a boat ahead of them —
 * exactly who this control exists for. Returns them with the booking the
 * action should choose: their soonest still-scheduled departure.
 */
async function upcomingSeats(db: AppDb, shopId: string) {
  return db
    .select({ personId: bookings.personId, bookingId: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, nowDate()),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(trips.startsAt);
}

async function diverOwingASignature(db: AppDb, shopId: string) {
  const seats = await upcomingSeats(db, shopId);
  const signed = await db
    .select({ personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.shopId, shopId), isNull(waiverRecords.supersededAt)))
    .then((records) => new Set(records.map((record) => record.personId)));
  const chosen = seats.find((seat) => !signed.has(seat.personId));
  if (!chosen) throw new Error("seeded shop has no unsigned diver with a scheduled departure");
  // `seats` is sorted by departure, so the first row for this diver is the
  // soonest — the same seat `paperWaiverBookingId` picks.
  return { seats, ...chosen };
}

async function completedWaiverCount(db: AppDb, shopId: string, personId: string) {
  const records = await db
    .select({ id: waiverRecords.id })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "completed"),
      ),
    );
  return records.length;
}

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  return { db, shop, ...(await diverOwingASignature(db, shop.id)) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recording a paper waiver from the diver record", () => {
  it("files the release against the diver's soonest scheduled departure", async () => {
    const { db, shop, personId, bookingId } = await context();
    const formData = new FormData();
    formData.set("bookingId", bookingId);
    formData.set("medicalAttested", "on");

    const to = await redirectedTo(() => markWaiverInPersonAction(shop.slug, personId, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=waiver-paper-recorded&form=waiver`,
    );
    const [record] = await db
      .select({ bookingId: waiverRecords.bookingId, method: waiverRecords.signatureMethod })
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, shop.id),
          eq(waiverRecords.personId, personId),
          eq(waiverRecords.status, "completed"),
        ),
      );
    expect(record?.bookingId).toBe(bookingId);
    // Staff-attested, not self-service: the record says who stood behind it.
    expect(record?.method).toBe("in_person_attested");
  });

  it("refuses without the medical attestation, and writes nothing", async () => {
    const { db, shop, personId, bookingId } = await context();
    const formData = new FormData();
    formData.set("bookingId", bookingId);

    const to = await redirectedTo(() => markWaiverInPersonAction(shop.slug, personId, formData));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=waiver-medical-attestation&form=waiver`,
    );
    expect(await completedWaiverCount(db, shop.id, personId)).toBe(0);
  });

  it("refuses a booking id that is not this diver's, and writes nothing", async () => {
    // The page renders one hidden booking id, but a form post can carry any of
    // them. The seat is derived from the record being looked at, so a
    // substituted id can never file one diver's release against another's.
    const { db, shop, personId, seats } = await context();
    const foreign = seats.find((seat) => seat.personId !== personId);
    if (!foreign) throw new Error("seeded shop has only one diver with an upcoming seat");
    const before = await completedWaiverCount(db, shop.id, foreign.personId);
    const formData = new FormData();
    formData.set("bookingId", foreign.bookingId);
    formData.set("medicalAttested", "on");

    const to = await redirectedTo(() => markWaiverInPersonAction(shop.slug, personId, formData));

    expect(to).toBe(`/shop/${shop.slug}/divers/${personId}?notice=waiver-error&form=waiver`);
    expect(await completedWaiverCount(db, shop.id, personId)).toBe(0);
    expect(await completedWaiverCount(db, shop.id, foreign.personId)).toBe(before);
  });
});
