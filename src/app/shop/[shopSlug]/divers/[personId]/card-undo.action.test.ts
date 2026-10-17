import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNitroxCertification, verifiedNitroxPersonIds } from "@/db/nitrox";
import {
  createCertification,
  createSpecialtyCertification,
  reviewCertification,
} from "@/db/readiness";
import { certifications, nitroxCertifications, people, specialtyCertifications } from "@/db/schema";
import { recordSelfDeclaredCards } from "@/db/self-declared-cards";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

/**
 * **The Undo on "Certification marked verified"** (`markCertifiedAction`,
 * `intent=undo`). One action routes three card types to three un-review
 * writers, so each type is tapped and undone here and the row read back: an
 * undo that hit the wrong table would leave a card verified that the staffer
 * believes they took back. A sighted card has nothing to put back and is
 * refused whatever the posted form says.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { markCertifiedAction } = await import("./card-actions");

const ctx = fileScopedShopContext();

// The suite freezes the clock, so two reviews would carry one instant: move it
// on a minute at a time between them, and put it back after each test.
const FROZEN_CLOCK = process.env.DIVEDAY_CLOCK;
let minutesLater = 0;
function laterBy(minutes: number) {
  minutesLater += minutes;
  process.env.DIVEDAY_CLOCK = new Date(
    Date.parse(FROZEN_CLOCK ?? "") + minutesLater * 60_000,
  ).toISOString();
}
afterEach(() => {
  minutesLater = 0;
  if (FROZEN_CLOCK === undefined) delete process.env.DIVEDAY_CLOCK;
  else process.env.DIVEDAY_CLOCK = FROZEN_CLOCK;
});

async function context() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Undo Uma", email: "uma@example.com" })
    .returning();
  if (!person) throw new Error("failed to insert a diver");
  return { db, shop, personId: person.id };
}

function tap(certificationId: string, cardType: string, intent?: "undo", reviewedAt?: string) {
  const formData = new FormData();
  formData.set("certificationId", certificationId);
  formData.set("cardType", cardType);
  if (intent) formData.set("intent", intent);
  if (reviewedAt) formData.set("reviewedAt", reviewedAt);
  return formData;
}

/** The Undo the toast offers for a tap: the card and the review it was rendered for. */
function offeredUndo(tapped: Awaited<ReturnType<typeof markCertifiedAction>>) {
  if (!tapped?.ok || !tapped.undo) throw new Error("the tap offered no Undo");
  return tapped.undo;
}

describe("undoing a one-tap card review", () => {
  it("puts a level card back to pending", async () => {
    const { db, shop, personId } = await context();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "UNDO-LEVEL",
    });
    if (!card) throw new Error("card insert failed");

    const tapped = await markCertifiedAction(shop.slug, personId, null, tap(card.id, "level"));
    expect(tapped).toMatchObject({ ok: true, effect: "certified" });
    const undone = await markCertifiedAction(
      shop.slug,
      personId,
      null,
      tap(card.id, "level", "undo", offeredUndo(tapped).reviewedAt),
    );

    expect(undone).toEqual({ ok: true, effect: "undone" });
    const [row] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(row).toMatchObject({ status: "pending", reviewedAt: null, reviewedByPersonId: null });
  });

  it("puts a specialty card back to pending", async () => {
    const { db, shop, personId } = await context();
    const card = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      specialty: "deep",
      identifier: "UNDO-DEEP",
    });
    if (!card) throw new Error("card insert failed");

    const tapped = await markCertifiedAction(shop.slug, personId, null, tap(card.id, "specialty"));
    const undone = await markCertifiedAction(
      shop.slug,
      personId,
      null,
      tap(card.id, "specialty", "undo", offeredUndo(tapped).reviewedAt),
    );

    expect(undone).toEqual({ ok: true, effect: "undone" });
    const [row] = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.id, card.id));
    expect(row).toMatchObject({ status: "pending", reviewedAt: null });
  });

  it("puts a nitrox card back to pending and out of the fill gate", async () => {
    const { db, shop, personId } = await context();
    const card = await createNitroxCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      identifier: "UNDO-EANX",
    });
    if (!card) throw new Error("card insert failed");

    const tapped = await markCertifiedAction(shop.slug, personId, null, tap(card.id, "nitrox"));
    expect(await verifiedNitroxPersonIds(db, shop.id)).toContain(personId);
    const undone = await markCertifiedAction(
      shop.slug,
      personId,
      null,
      tap(card.id, "nitrox", "undo", offeredUndo(tapped).reviewedAt),
    );

    expect(undone).toEqual({ ok: true, effect: "undone" });
    const [row] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, card.id));
    expect(row).toMatchObject({ status: "pending", reviewedAt: null });
    expect(await verifiedNitroxPersonIds(db, shop.id)).not.toContain(personId);
  });

  it("refuses to undo a card that was verified by sighting it, and it stays verified", async () => {
    const { db, shop, personId } = await context();
    await recordSelfDeclaredCards(db, { shopId: shop.id, personId, level: "rescue" });
    const [claim] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, personId));
    if (!claim) throw new Error("self-declaration wrote no card");
    // Verified by a staffer with the card in hand: the sighting path rewrites
    // the row from the plastic, which is why there is nothing to put back.
    await db
      .update(certifications)
      .set({
        status: "verified",
        agency: "padi",
        identifier: "PADI-SIGHTED",
        reviewedAt: new Date("2026-07-20T12:00:00Z"),
      })
      .where(eq(certifications.id, claim.id));

    const undone = await markCertifiedAction(
      shop.slug,
      personId,
      null,
      tap(claim.id, "level", "undo", "2026-07-20T12:00:00.000Z"),
    );

    expect(undone).toEqual({ ok: false, reason: "not-undoable" });
    const [row] = await db.select().from(certifications).where(eq(certifications.id, claim.id));
    expect(row?.status).toBe("verified");
  });

  it("refuses an Undo that names no review, or a nonsense one, and the card stays certified", async () => {
    const { db, shop, personId } = await context();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "UNDO-NO-STAMP",
    });
    if (!card) throw new Error("card insert failed");
    await markCertifiedAction(shop.slug, personId, null, tap(card.id, "level"));

    for (const reviewedAt of [undefined, "", "not a date"]) {
      const undone = await markCertifiedAction(
        shop.slug,
        personId,
        null,
        tap(card.id, "level", "undo", reviewedAt),
      );
      expect(undone).toEqual({ ok: false, reason: "not-undoable" });
    }
    const [row] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(row?.status).toBe("verified");
  });

  /**
   * **A stale Undo wipes nothing** (issue #2612). Mark certified, the toast
   * stays on screen, the card is re-reviewed through the agency check, then the
   * first toast's Undo (or a replayed post) arrives: the agency-checked review
   * and its evidence must survive.
   */
  it("does not let a stale Undo wipe a later agency-checked review", async () => {
    const { db, shop, personId } = await context();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "UNDO-STALE-LEVEL",
    });
    if (!card) throw new Error("card insert failed");
    const tapped = await markCertifiedAction(shop.slug, personId, null, tap(card.id, "level"));
    const stale = offeredUndo(tapped).reviewedAt;

    // The agency check re-reviews it a moment later and files its evidence.
    laterBy(1);
    const rechecked = await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      agencyChecked: true,
      reviewNote: "PADI page lists this diver at Rescue.",
    });
    expect(rechecked.ok).toBe(true);

    const undone = await markCertifiedAction(
      shop.slug,
      personId,
      null,
      tap(card.id, "level", "undo", stale),
    );

    expect(undone).toEqual({ ok: false, reason: "not-undoable" });
    const [row] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(row?.status).toBe("verified");
    expect(row?.agencyCheckedAt).not.toBeNull();
    expect(row?.reviewNote).toBe("PADI page lists this diver at Rescue.");
    expect(row?.reviewedAt).not.toBeNull();
  });

  it("refuses to undo an agency-checked review even with its exact stamp", async () => {
    const { db, shop, personId } = await context();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "UNDO-FORGED",
    });
    if (!card) throw new Error("card insert failed");
    const checked = await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      agencyChecked: true,
      reviewNote: "PADI page lists this diver at Rescue.",
    });
    if (!checked.ok || !checked.certification.reviewedAt) throw new Error("agency review failed");

    const undone = await markCertifiedAction(
      shop.slug,
      personId,
      null,
      tap(card.id, "level", "undo", checked.certification.reviewedAt.toISOString()),
    );

    expect(undone).toEqual({ ok: false, reason: "not-undoable" });
    const [row] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(row?.agencyCheckedAt).not.toBeNull();
    expect(row?.status).toBe("verified");
  });

  it("refuses a specialty or nitrox Undo once the card has been reviewed again", async () => {
    const { db, shop, personId } = await context();
    const specialty = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      specialty: "wreck",
      identifier: "UNDO-STALE-WRECK",
    });
    const nitrox = await createNitroxCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      identifier: "UNDO-STALE-EANX",
    });
    if (!specialty || !nitrox) throw new Error("card insert failed");
    const specialtyTap = offeredUndo(
      await markCertifiedAction(shop.slug, personId, null, tap(specialty.id, "specialty")),
    );
    const nitroxTap = offeredUndo(
      await markCertifiedAction(shop.slug, personId, null, tap(nitrox.id, "nitrox")),
    );

    // Each is undone and certified again: a newer review than the toasts' own.
    laterBy(1);
    for (const [id, cardType, offered] of [
      [specialty.id, "specialty", specialtyTap],
      [nitrox.id, "nitrox", nitroxTap],
    ] as const) {
      await markCertifiedAction(
        shop.slug,
        personId,
        null,
        tap(id, cardType, "undo", offered.reviewedAt),
      );
      laterBy(1);
      await markCertifiedAction(shop.slug, personId, null, tap(id, cardType));
      const replay = await markCertifiedAction(
        shop.slug,
        personId,
        null,
        tap(id, cardType, "undo", offered.reviewedAt),
      );
      expect(replay, cardType).toEqual({ ok: false, reason: "not-undoable" });
    }
    const [wreck] = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.id, specialty.id));
    const [eanx] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, nitrox.id));
    expect(wreck?.status).toBe("verified");
    expect(eanx?.status).toBe("verified");
    expect(await verifiedNitroxPersonIds(db, shop.id)).toContain(personId);
  });
});
