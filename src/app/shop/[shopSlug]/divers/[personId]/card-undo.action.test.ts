import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createNitroxCertification, verifiedNitroxPersonIds } from "@/db/nitrox";
import { createCertification, createSpecialtyCertification } from "@/db/readiness";
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

function tap(certificationId: string, cardType: string, intent?: "undo") {
  const formData = new FormData();
  formData.set("certificationId", certificationId);
  formData.set("cardType", cardType);
  if (intent) formData.set("intent", intent);
  return formData;
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
      tap(card.id, "level", "undo"),
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

    await markCertifiedAction(shop.slug, personId, null, tap(card.id, "specialty"));
    const undone = await markCertifiedAction(
      shop.slug,
      personId,
      null,
      tap(card.id, "specialty", "undo"),
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

    await markCertifiedAction(shop.slug, personId, null, tap(card.id, "nitrox"));
    expect(await verifiedNitroxPersonIds(db, shop.id)).toContain(personId);
    const undone = await markCertifiedAction(
      shop.slug,
      personId,
      null,
      tap(card.id, "nitrox", "undo"),
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
      tap(claim.id, "level", "undo"),
    );

    expect(undone).toEqual({ ok: false, reason: "not-undoable" });
    const [row] = await db.select().from(certifications).where(eq(certifications.id, claim.id));
    expect(row?.status).toBe("verified");
  });
});
