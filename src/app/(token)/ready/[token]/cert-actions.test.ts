import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { firstActiveIntroCourse } from "@/db/courses";
import { createCertification } from "@/db/readiness";
import { getReadyPageData } from "@/db/ready";
import {
  bookings,
  certifications,
  nitroxCertifications,
  people,
  specialtyCertifications,
  trips,
} from "@/db/schema";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

/**
 * **"I'm not certified yet" on `/ready`** (third UX review, item 23), against a
 * real database: the diver's word lands as the stamp the public join writes,
 * never as a card, it is refused over a card the shop holds, and a seat that is
 * not a diver's cannot say it.
 */

const fileCtx = fileScopedShopContext();

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
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US"),
  requestFirstHandLocale: vi.fn(async () => null),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { getDb } = await import("@/db/client");
const { declareNoCertificationFromReady } = await import("./cert-actions");

afterEach(() => vi.clearAllMocks());

/** A booked diver ahead of departure, holding no card at all, with a readiness link. */
async function seat() {
  const { db, shop } = fileCtx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [row] = await db
    .select({ bookingId: bookings.id, personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        eq(bookings.status, "booked"),
        ne(trips.status, "cancelled"),
        gt(trips.startsAt, new Date(nowDate().getTime() + DAY_MS)),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!row) throw new Error("seed has no booked seat");
  await db
    .update(bookings)
    .set({ participantType: "diver", identityUnconfirmedAt: null })
    .where(eq(bookings.id, row.bookingId));
  const at = nowDate();
  for (const table of [certifications, nitroxCertifications, specialtyCertifications]) {
    await db
      .update(table)
      .set({ deletedAt: at })
      .where(and(eq(table.shopId, shop.id), eq(table.personId, row.personId)));
  }
  await db
    .update(people)
    .set({ noCertificationDeclaredAt: null, noCertificationClearedAt: null })
    .where(eq(people.id, row.personId));
  const issued = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: row.bookingId,
    purpose: "readiness",
  });
  if (!issued) throw new Error("no readiness link");
  return { db, shop, ...row, token: issued.token };
}

async function declare(token: string): Promise<string> {
  try {
    await declareNoCertificationFromReady(token);
  } catch (error) {
    return (error as Error).message.replace("REDIRECT:", "");
  }
  throw new Error("expected a redirect");
}

async function stamp(personId: string) {
  const [row] = await fileCtx.db
    .select({ declaredAt: people.noCertificationDeclaredAt })
    .from(people)
    .where(eq(people.id, personId));
  return row?.declaredAt ?? null;
}

describe("declareNoCertificationFromReady", () => {
  it("records the diver's word on the person and opens the try-it course", async () => {
    const { db, shop, bookingId, personId, token } = await seat();
    expect(await declare(token)).toBe(`/ready/${token}?saved=not-yet`);
    expect(await stamp(personId)).not.toBeNull();
    // A stamp, never a card: no certification row was written for them.
    const live = await db
      .select({ id: certifications.id })
      .from(certifications)
      .where(
        and(
          eq(certifications.personId, personId),
          eq(certifications.shopId, shop.id),
          isNull(certifications.deletedAt),
        ),
      );
    expect(live).toEqual([]);
    // The seat's own gate decides whether the door shows; when it does, it is
    // the shop's first try-it course.
    const data = await getReadyPageData(db, bookingId);
    const intro = await firstActiveIntroCourse(db, shop.id);
    expect(data?.certificationNotYet?.introCourse?.title ?? null).toBe(intro?.title ?? null);
    expect(data?.certificationNotYet).not.toBeNull();
  });

  it("changes nothing over a card the shop holds", async () => {
    const { db, shop, personId, token } = await seat();
    await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-ITEM23",
    });
    expect(await declare(token)).toBe(`/ready/${token}?saved=not-yet-card`);
    expect(await stamp(personId)).toBeNull();
  });

  it("refuses a seat that is not a diver's", async () => {
    const { db, bookingId, personId, token } = await seat();
    await db
      .update(bookings)
      .set({ participantType: "snorkeler" })
      .where(eq(bookings.id, bookingId));
    expect(await declare(token)).toBe(`/ready/${token}`);
    expect(await stamp(personId)).toBeNull();
  });

  it("refuses while the seat is held for staff to confirm who it is", async () => {
    const { db, bookingId, personId, token } = await seat();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, bookingId));
    expect(await declare(token)).toBe(`/ready/${token}`);
    expect(await stamp(personId)).toBeNull();
  });
});
