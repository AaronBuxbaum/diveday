import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { bookings, people, waiverRecords } from "@/db/schema";
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
 * The third door onto `recordInPersonWaiver` (the roster and the check-in queue
 * are the other two) and the only one scoped to a *person* rather than a
 * departure. What these tests pin is that it stays that way: the subject comes
 * from the route, the record carries no seat, and the medical attestation is
 * still required here (H-01/H-03; ADR 20260811-person-scoped-paper-waivers).
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

/** A seeded person who owes a signature — exactly who this control is for. */
async function diverOwingASignature(db: AppDb, shopId: string): Promise<string> {
  const signed = await db
    .select({ personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(and(eq(waiverRecords.shopId, shopId), isNull(waiverRecords.supersededAt)))
    .then((records) => new Set(records.map((record) => record.personId)));
  const rows = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), isNull(people.deletedAt), isNull(people.anonymizedAt)))
    .orderBy(people.fullName);
  const chosen = rows.find((row) => !signed.has(row.id));
  if (!chosen) throw new Error("seeded shop has nobody without a live waiver record");
  return chosen.id;
}

async function completedWaivers(db: AppDb, shopId: string, personId: string) {
  return db
    .select({ id: waiverRecords.id, bookingId: waiverRecords.bookingId })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shopId),
        eq(waiverRecords.personId, personId),
        eq(waiverRecords.status, "completed"),
      ),
    );
}

async function context() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  return { db, shop, personId: await diverOwingASignature(db, shop.id) };
}

function attested() {
  const formData = new FormData();
  formData.set("medicalAttested", "on");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recording a paper waiver from the diver record", () => {
  it("files the release against the diver and no seat", async () => {
    const { db, shop, personId } = await context();

    const to = await redirectedTo(() => markWaiverInPersonAction(shop.slug, personId, attested()));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=waiver-paper-recorded&form=waiver`,
    );
    const [record] = await completedWaivers(db, shop.id, personId);
    // The whole point: a signature is a fact about a person and a shop, so the
    // record names nobody's Saturday.
    expect(record?.bookingId).toBeNull();
    const [full] = await db
      .select({ method: waiverRecords.signatureMethod, hash: waiverRecords.integrityHash })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, record?.id ?? ""));
    // Staff-attested, not self-service, and sealed like every other record.
    expect(full?.method).toBe("in_person_attested");
    expect(full?.hash).toBeTruthy();
  });

  it("works for a diver with nothing booked at all", async () => {
    // The case the booking-shaped writer could not serve, and the reason this
    // ADR exists: somebody hands the release over months before they book.
    const { db, shop } = await context();
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Paperwork Early Pat" })
      .returning();
    if (!person) throw new Error("failed to insert a diver");
    expect(await db.select().from(bookings).where(eq(bookings.personId, person.id))).toHaveLength(
      0,
    );

    const to = await redirectedTo(() => markWaiverInPersonAction(shop.slug, person.id, attested()));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${person.id}?notice=waiver-paper-recorded&form=waiver`,
    );
    expect(await completedWaivers(db, shop.id, person.id)).toHaveLength(1);
  });

  it("refuses without the medical attestation, and writes nothing", async () => {
    const { db, shop, personId } = await context();

    const to = await redirectedTo(() =>
      markWaiverInPersonAction(shop.slug, personId, new FormData()),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=waiver-medical-attestation&form=waiver`,
    );
    expect(await completedWaivers(db, shop.id, personId)).toHaveLength(0);
  });

  it("does not stack a second record on a diver who already holds a current one", async () => {
    const { db, shop, personId } = await context();
    await redirectedTo(() => markWaiverInPersonAction(shop.slug, personId, attested()));

    const to = await redirectedTo(() => markWaiverInPersonAction(shop.slug, personId, attested()));

    // Idempotent, and it still reports success: the shop's question ("is this
    // diver's release on file?") is answered either way.
    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=waiver-paper-recorded&form=waiver`,
    );
    expect(await completedWaivers(db, shop.id, personId)).toHaveLength(1);
  });

  it("refuses to attest for a removed diver, and writes nothing", async () => {
    // A release is a document that may have to stand up outside the company,
    // and one attested for somebody the shop had already taken off its books is
    // not one — the same rule `activeStaffAttestorId` applies to the staffer
    // signing it off, applied to the diver it is about.
    const { db, shop } = await context();
    const [removed] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Removed Rita", deletedAt: new Date() })
      .returning();
    if (!removed) throw new Error("failed to insert a removed diver");

    const to = await redirectedTo(() =>
      markWaiverInPersonAction(shop.slug, removed.id, attested()),
    );

    expect(to).toBe(`/shop/${shop.slug}/divers/${removed.id}?notice=waiver-error&form=waiver`);
    expect(await completedWaivers(db, shop.id, removed.id)).toHaveLength(0);
  });
});
