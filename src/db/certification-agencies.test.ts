import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createNitroxCertification } from "./nitrox";
import {
  createCertification,
  createSpecialtyCertification,
  getBookingReadiness,
  reviewCertification,
  upsertTripRequirements,
} from "./readiness";
import { type CertificationAgency, certificationAgency, certifications } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";

/**
 * CMAS, RAID, GUE and BSAC are recordable, and recording them changes no gate.
 *
 * The agency enum omitted all four, so a diver holding one of those cards
 * could only be filed as "other" — a card the shop can see is not the card the
 * diver holds (DOM-L1, review 20260802). Widening a safety-adjacent enum earns
 * the second half of this file: nothing in readiness, trip admission, or the
 * nitrox fill gate reads the agency, so a card clears on its **level** and its
 * **verification state** and a CMAS diver is admitted on exactly the terms a
 * PADI diver is — never more, and never less.
 *
 * BSAC arrived a change later, on the `dive-domain-expert` review of the first
 * widening: a national governing body with a full ISO-aligned ladder, and the
 * most common non-listed card on a Florida or Caribbean boat. It is still not
 * an exhaustive list — IANTD, SEI, ANDI, ACUC, PSAI and NASE remain `other`,
 * and the honest fix for those is a free-text companion to `other`, not an
 * ever-longer enum (glossary, "Other agency").
 */
async function agencyContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [rosterEntry] = await getTripRoster(db, shop.id, reef.id);
  if (!rosterEntry) throw new Error("demo booking missing");
  return { db, shop, reef, rosterEntry };
}

const ADDED_AGENCIES = [
  "cmas",
  "raid",
  "gue",
  "bsac",
] as const satisfies readonly CertificationAgency[];

describe("certification agencies (DOM-L1)", () => {
  it("carries the agencies the review named, and keeps 'other' last for the picker", () => {
    const values = certificationAgency.enumValues;

    expect(values).toEqual(expect.arrayContaining([...ADDED_AGENCIES]));
    // The cert forms render `AGENCY_KEYS` in declaration order, so "other"
    // sitting last is a UI fact this list owes them — and the one thing a later
    // widening can silently get wrong, since `ADD VALUE` appends unless it is
    // told `BEFORE 'other'`.
    expect(values.at(-1)).toBe("other");
    // Asserted as properties rather than as a literal list on purpose: this
    // enum is meant to keep growing, and a copy of it here would turn every
    // future agency into a failing test in a file that has nothing to say
    // about it. What must not change is above.
    expect(new Set(values).size).toBe(values.length);
  });

  it.each(ADDED_AGENCIES)("records a level card issued by %s", async (agency) => {
    const { db, shop, rosterEntry } = await agencyContext();

    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency,
      level: "advanced_open_water",
      identifier: `${agency.toUpperCase()}-AOW-1`,
    });
    if (!card) throw new Error("expected certification to insert");

    const [stored] = await db
      .select({ agency: certifications.agency })
      .from(certifications)
      .where(and(eq(certifications.id, card.id), eq(certifications.shopId, shop.id)));
    // Round-tripped through the column, so this fails if the pg enum did not
    // actually gain the value rather than only the TypeScript union.
    expect(stored?.agency).toBe(agency);
  });

  it.each(ADDED_AGENCIES)("records a specialty and a nitrox card issued by %s", async (agency) => {
    const { db, shop, rosterEntry } = await agencyContext();

    const specialty = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency,
      specialty: "deep",
      identifier: `${agency.toUpperCase()}-DEEP-1`,
    });
    const nitrox = await createNitroxCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency,
      identifier: `${agency.toUpperCase()}-NX-1`,
    });

    expect(specialty?.agency).toBe(agency);
    expect(nitrox?.agency).toBe(agency);
  });

  it("clears a cert gate on the level, never on whose logo is on the card", async () => {
    const { db, shop, reef, rosterEntry } = await agencyContext();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: "rescue",
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });

    const pending = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "cmas",
      level: "rescue",
      identifier: "CMAS-RESCUE-1",
    });
    if (!pending) throw new Error("expected certification to insert");

    // Failure path first, and it is the *same* failure path a PADI card walks:
    // an unreviewed card is evidence nobody has looked at, whatever the agency.
    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).toContainEqual(expect.objectContaining({ code: "certification_pending" }));

    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: pending.id,
      status: "verified",
    });
    expect(await getBookingReadiness(db, shop.id, rosterEntry.booking.id)).toEqual({
      status: "ready",
      blockers: [],
    });
  });

  it("does not let a new agency stand in for a level the diver does not hold", async () => {
    // The adversarial reading of "we widened a safety-adjacent enum": a card
    // from an agency the app has only just learned about must not be treated as
    // more (or less) than the rung it names.
    const { db, shop, reef, rosterEntry } = await agencyContext();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: "divemaster",
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });

    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "gue",
      level: "open_water",
      identifier: "GUE-OW-1",
    });
    if (!card) throw new Error("expected certification to insert");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });

    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).toContainEqual(
      expect.objectContaining({
        code: "certification_insufficient",
        params: { requiredLevel: "divemaster" },
      }),
    );
  });
});
