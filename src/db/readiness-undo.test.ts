import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  createNitroxCertification,
  reviewNitroxCertification,
  unreviewNitroxCertification,
} from "./nitrox";
import {
  createCertification,
  createSpecialtyCertification,
  getBookingReadiness,
  reverseCertificationReview,
  reviewCertification,
  reviewSpecialtyCertification,
  unreviewCertification,
  unreviewSpecialtyCertification,
  upsertTripRequirements,
} from "./readiness";
import type { DiveSpecialty } from "./schema";
import { certifications, shops, specialtyCertifications } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

async function readinessContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [rosterEntry] = await getTripRoster(db, shop.id, reef.id);
  if (!rosterEntry) throw new Error("demo booking missing");
  return { db, shop, reef, rosterEntry };
}

/** The instant a card was last reviewed, which an Undo is offered for (issue #2612). */
async function levelReviewedAt(db: AppDb, id: string): Promise<Date> {
  const [row] = await db
    .select({ reviewedAt: certifications.reviewedAt })
    .from(certifications)
    .where(eq(certifications.id, id));
  return row?.reviewedAt ?? new Date(0);
}

async function specialtyReviewedAt(db: AppDb, id: string): Promise<Date> {
  const [row] = await db
    .select({ reviewedAt: specialtyCertifications.reviewedAt })
    .from(specialtyCertifications)
    .where(eq(specialtyCertifications.id, id));
  return row?.reviewedAt ?? new Date(0);
}

/**
 * **Undoing a card review** puts the gate back. A staffer who verified the
 * wrong card taps "Undo"; the diver's next departure must read blocked again
 * at once, not keep the clearance the mistaken tap gave them.
 */
describe("undoing a card review (unreviewCertification / unreviewSpecialtyCertification)", () => {
  async function gateOnly(
    db: ReturnType<typeof fileScopedShopContext>["db"],
    shopId: string,
    tripId: string,
    gate: { level?: "rescue"; specialty?: DiveSpecialty },
  ) {
    await upsertTripRequirements(db, {
      shopId,
      tripId,
      requiresWaiver: false,
      minimumCertificationLevel: gate.level ?? null,
      requiredSpecialties: gate.specialty ? [gate.specialty] : [],
      requiresNitrox: false,
      requiresPayment: false,
    });
  }

  it("blocks the diver's next trip again once a level card's review is undone", async () => {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await gateOnly(db, shop.id, reef.id, { level: "rescue" });
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESCUE-UNDO",
    });
    if (!card) throw new Error("expected certification to insert");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });
    expect((await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.status).toBe("ready");

    expect(
      await unreviewCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        reviewedAt: await levelReviewedAt(db, card.id),
      }),
    ).toEqual({
      ok: true,
    });

    const after = await getBookingReadiness(db, shop.id, rosterEntry.booking.id);
    expect(after?.status).toBe("blocked");
    expect(after?.blockers).toContainEqual(
      expect.objectContaining({ code: "certification_pending" }),
    );
  });

  it("blocks the diver's next trip again once a specialty card's review is undone", async () => {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await gateOnly(db, shop.id, reef.id, { specialty: "cavern" });
    const before = await getBookingReadiness(db, shop.id, rosterEntry.booking.id);
    expect(before?.blockers).toContainEqual(expect.objectContaining({ code: "specialty_missing" }));
    const card = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      specialty: "cavern",
      identifier: "PADI-CAVERN-UNDO",
    });
    if (!card) throw new Error("expected specialty card to insert");
    await reviewSpecialtyCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });
    expect((await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.status).toBe("ready");

    expect(
      await unreviewSpecialtyCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        reviewedAt: await specialtyReviewedAt(db, card.id),
      }),
    ).toEqual({ ok: true });

    const after = await getBookingReadiness(db, shop.id, rosterEntry.booking.id);
    expect(after?.status).toBe("blocked");
    expect(after?.blockers).toContainEqual(expect.objectContaining({ code: "specialty_pending" }));
  });

  it("answers not_found through another shop's id and leaves the review standing", async () => {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await gateOnly(db, shop.id, reef.id, { level: "rescue" });
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESCUE-TENANT",
    });
    const specialty = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      specialty: "cavern",
      identifier: "PADI-CAVERN-TENANT",
    });
    if (!card || !specialty) throw new Error("expected cards to insert");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });
    await reviewSpecialtyCertification(db, {
      shopId: shop.id,
      certificationId: specialty.id,
      status: "verified",
    });
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-unreview", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");

    expect(
      await unreviewCertification(db, {
        shopId: rival.id,
        certificationId: card.id,
        reviewedAt: await levelReviewedAt(db, card.id),
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await unreviewSpecialtyCertification(db, {
        shopId: rival.id,
        certificationId: specialty.id,
        reviewedAt: await specialtyReviewedAt(db, specialty.id),
      }),
    ).toEqual({ ok: false, reason: "not_found" });

    const [level] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(level).toMatchObject({ status: "verified" });
    expect(level?.reviewedAt).not.toBeNull();
    expect((await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.status).toBe("ready");
  });

  /**
   * **An Undo belongs to the review it was offered for** (issue #2612). The
   * answer is `stale` for a card reviewed since, `agency_checked` for a review
   * an agency check made, and in neither case is the row touched.
   */
  it("refuses a stale Undo on all three card types, leaving the later review alone", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const personId = rosterEntry.person.id;
    const level = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-STALE-LEVEL",
    });
    const specialty = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      specialty: "deep",
      identifier: "PADI-STALE-DEEP",
    });
    const nitrox = await createNitroxCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      identifier: "PADI-STALE-EANX",
    });
    if (!level || !specialty || !nitrox) throw new Error("expected cards to insert");
    const offered = new Date("2026-07-21T13:00:00.000Z");
    // The reviews the toasts were offered for are older than the stored ones.
    const base = { shopId: shop.id, status: "verified" } as const;
    await reviewCertification(db, { ...base, certificationId: level.id });
    await reviewSpecialtyCertification(db, { ...base, certificationId: specialty.id });
    await reviewNitroxCertification(db, { ...base, certificationId: nitrox.id });

    for (const result of [
      await unreviewCertification(db, {
        shopId: shop.id,
        certificationId: level.id,
        reviewedAt: offered,
      }),
      await unreviewSpecialtyCertification(db, {
        shopId: shop.id,
        certificationId: specialty.id,
        reviewedAt: offered,
      }),
      await unreviewNitroxCertification(db, {
        shopId: shop.id,
        certificationId: nitrox.id,
        reviewedAt: offered,
      }),
    ]) {
      expect(result).toEqual({ ok: false, reason: "stale" });
    }
    expect(await levelReviewedAt(db, level.id)).not.toEqual(new Date(0));
    expect((await specialtyReviewedAt(db, specialty.id)).getTime()).toBeGreaterThan(0);
    const [stillLevel] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.id, level.id));
    expect(stillLevel?.status).toBe("verified");
  });

  it("refuses the one-tap Undo of an agency-checked review, and lets the agency check's own through", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-AGENCY-UNDO",
    });
    if (!card) throw new Error("expected certification to insert");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      agencyChecked: true,
      reviewNote: "PADI page lists this diver.",
    });
    const reviewedAt = await levelReviewedAt(db, card.id);

    expect(
      await unreviewCertification(db, { shopId: shop.id, certificationId: card.id, reviewedAt }),
    ).toEqual({ ok: false, reason: "agency_checked" });
    const [kept] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(kept).toMatchObject({ status: "verified", reviewNote: "PADI page lists this diver." });
    expect(kept?.agencyCheckedAt).not.toBeNull();

    expect(
      await reverseCertificationReview(db, {
        shopId: shop.id,
        certificationId: card.id,
        reviewedAt,
        reversingAgencyCheck: true,
      }),
    ).toMatchObject({ ok: true });
    const [undone] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(undone).toMatchObject({ status: "pending", reviewNote: null, agencyCheckedAt: null });
  });

  it("refuses to undo a card staff issued or sighted, and one nobody reviewed", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const issued = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESCUE-ISSUED",
    });
    const fresh = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "advanced_open_water",
      identifier: "PADI-AOW-FRESH",
    });
    if (!issued || !fresh) throw new Error("expected cards to insert");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: issued.id,
      status: "verified",
    });
    await db
      .update(certifications)
      .set({ issuedByShopAt: nowDate() })
      .where(eq(certifications.id, issued.id));

    expect(
      await unreviewCertification(db, {
        shopId: shop.id,
        certificationId: issued.id,
        reviewedAt: await levelReviewedAt(db, issued.id),
      }),
    ).toEqual({ ok: false, reason: "sighted_card" });
    const [still] = await db.select().from(certifications).where(eq(certifications.id, issued.id));
    expect(still?.reviewedAt).not.toBeNull();

    expect(
      await unreviewCertification(db, {
        shopId: shop.id,
        certificationId: fresh.id,
        reviewedAt: await levelReviewedAt(db, fresh.id),
      }),
    ).toEqual({ ok: false, reason: "not_reviewed" });
  });
});
