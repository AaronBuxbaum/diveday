import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import {
  bookings,
  certifications,
  nitroxCertifications,
  orders,
  people,
  personRoles,
  specialtyCertifications,
  waiverRecords,
} from "@/db/schema";
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

/**
 * **The record's one earned moment, and the condition under it.**
 *
 * `markWaiverInPersonAction` answers with `diver-clear` instead of its ordinary
 * success code when the act left `buildDiverStatus` empty (ADR
 * 20260827-people-not-lists's "the last thing clears"). Both halves are pinned:
 * the seeded divers above all still have something outstanding, so every test
 * in this file asserts the *ordinary* code, and this one strips the record bare
 * first to prove the swap fires only when nothing is waiting.
 */
async function clearEverythingElse(db: AppDb, shopId: string, personId: string) {
  await db.delete(certifications).where(eq(certifications.personId, personId));
  await db.delete(specialtyCertifications).where(eq(specialtyCertifications.personId, personId));
  await db.delete(nitroxCertifications).where(eq(nitroxCertifications.personId, personId));
  await db.delete(orders).where(eq(orders.personId, personId));
  await db.delete(bookings).where(eq(bookings.personId, personId));
  await db
    .update(people)
    .set({ emergencyContactName: "Kojo Mensah", emergencyContactPhone: "+13055550177" })
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)));
}

function attested() {
  const formData = new FormData();
  formData.set("medicalAttested", "on");
  return formData;
}

/**
 * Both tests here declare 40s rather than taking the file's 20s default. They
 * pay for two things the rest of the file does not: six extra writes to strip
 * the seeded record bare, and the post-mutation `diverRecordIsClear` read that
 * the earned moment is derived from (a whole `getDiverProfile` plus the next
 * booking's readiness). Neither is a race — the work is real and sequential,
 * and a ceiling only ever bounds a *failure* (playwright.config.ts states the
 * same rule for the e2e side).
 */
const CLEARING_TIMEOUT_MS = 40_000;

describe("the last thing clearing", () => {
  it(
    "answers with the earned moment only when nothing else is waiting",
    async () => {
      const { db, shop, personId } = await context();
      await clearEverythingElse(db, shop.id, personId);

      const to = await redirectedTo(() =>
        markWaiverInPersonAction(shop.slug, personId, attested()),
      );

      // No `&form=`: the moment belongs to the masthead, which is where
      // `NOTICE_KEYS` files `diver-clear`.
      expect(to).toBe(`/shop/${shop.slug}/divers/${personId}?notice=diver-clear`);
    },
    CLEARING_TIMEOUT_MS,
  );

  it(
    "keeps the ordinary success code while anything is still open",
    async () => {
      const { db, shop, personId } = await context();
      await clearEverythingElse(db, shop.id, personId);
      // One thing left undone is enough — the moment is about the whole record.
      await db.update(people).set({ emergencyContactPhone: "" }).where(eq(people.id, personId));

      const to = await redirectedTo(() =>
        markWaiverInPersonAction(shop.slug, personId, attested()),
      );

      expect(to).toBe(
        `/shop/${shop.slug}/divers/${personId}?notice=waiver-paper-recorded&form=waiver#waiver`,
      );
    },
    CLEARING_TIMEOUT_MS,
  );
});

describe("recording a paper waiver from the diver record", () => {
  it("files the release against the diver and no seat", async () => {
    const { db, shop, personId } = await context();

    const to = await redirectedTo(() => markWaiverInPersonAction(shop.slug, personId, attested()));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=waiver-paper-recorded&form=waiver#waiver`,
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
      `/shop/${shop.slug}/divers/${person.id}?notice=waiver-paper-recorded&form=waiver#waiver`,
    );
    expect(await completedWaivers(db, shop.id, person.id)).toHaveLength(1);
  });

  it("refuses without the medical attestation, and writes nothing", async () => {
    const { db, shop, personId } = await context();

    const to = await redirectedTo(() =>
      markWaiverInPersonAction(shop.slug, personId, new FormData()),
    );

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=waiver-medical-attestation&form=waiver#waiver`,
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
      `/shop/${shop.slug}/divers/${personId}?notice=waiver-paper-recorded&form=waiver#waiver`,
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

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${removed.id}?notice=waiver-error&form=waiver#waiver`,
    );
    expect(await completedWaivers(db, shop.id, removed.id)).toHaveLength(0);
  });

  it("refuses a staff account that was revoked after the page loaded", async () => {
    const { db, shop, personId } = await context();
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await db.delete(personRoles).where(eq(personRoles.personId, owner));

    const to = await redirectedTo(() => markWaiverInPersonAction(shop.slug, personId, attested()));

    expect(to).toBe(
      `/shop/${shop.slug}/divers/${personId}?notice=not-authorized-waiver&form=waiver#waiver`,
    );
    expect(await completedWaivers(db, shop.id, personId)).toHaveLength(0);
  });
});
