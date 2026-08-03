import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { verifiedNitroxPersonIds } from "./nitrox";
import { getBookingReadiness } from "./readiness";
import {
  bookings,
  nitroxCertifications,
  people,
  specialtyCertifications,
  tripRequirements,
} from "./schema";

describe("seeded imported-card states", () => {
  // The two states H-23/H-24 exist for are only visible on a diver who holds an
  // imported, unconfirmed card — and until this seed row existed, no seeded diver
  // did, so the amber "certified · confirm to clear" badge and the
  // attest-you've-seen-it confirm had no visual-regression baseline and no
  // fixture. This test
  // is the guard on the *shape* those baselines depend on: if someone drops or
  // confirms these rows, the visual coverage silently stops covering anything.
  it("holds an imported, unconfirmed specialty and nitrox card for one diver", async () => {
    const { db, shop } = await seededShopContext();
    const [hana] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Hana Kobayashi")))
      .limit(1);
    if (!hana) throw new Error("expected the seeded imported-card diver");

    const specialty = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, hana.id));
    expect(specialty).toHaveLength(1);
    // Verified (the prior system checked it) but unreviewed — which is exactly
    // the pair `specialtyBlocker` holds a depth gate on.
    expect(specialty[0]).toMatchObject({
      specialty: "deep",
      status: "verified",
      reviewedAt: null,
      importedFromLabel: "Coral Coast Divers",
    });
    expect(specialty[0].importedAt).toBeInstanceOf(Date);

    const nitrox = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.personId, hana.id));
    expect(nitrox).toHaveLength(1);
    expect(nitrox[0]).toMatchObject({ status: "verified", reviewedAt: null });
    expect(nitrox[0].importedAt).toBeInstanceOf(Date);
    // And the fill really is still held — this is the behaviour, not just the row.
    expect([...(await verifiedNitroxPersonIds(db, shop.id))]).not.toContain(hana.id);
  });

  it("cards that diver without disturbing the readiness any other spec asserts", async () => {
    // Why she is safe to card: her one seeded booking is on a trip that gates on
    // neither a specialty nor nitrox, so the two held gates above are inert there
    // and her blockers are exactly what they were before these rows existed. This
    // is the assumption the whole seed change rests on — asserted rather than
    // assumed, because a future seed that books her onto the deep or nitrox
    // charter would flip a blocker and quietly break unrelated specs.
    const { db, shop } = await seededShopContext();
    const [hana] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Hana Kobayashi")))
      .limit(1);
    if (!hana) throw new Error("expected the seeded imported-card diver");

    const booked = await db.select().from(bookings).where(eq(bookings.personId, hana.id));
    for (const booking of booked) {
      const [requirement] = await db
        .select()
        .from(tripRequirements)
        .where(eq(tripRequirements.tripId, booking.tripId));
      expect(requirement?.requiredSpecialties ?? []).toEqual([]);
      expect(requirement?.requiresNitrox ?? false).toBe(false);
      // So the imported cards hold nothing here: the only open blocker is the
      // waiver this diver hasn't signed.
      const readiness = await getBookingReadiness(db, shop.id, booking.id);
      expect(readiness?.blockers.map((b) => b.code)).toEqual(["waiver_pending"]);
    }
  });
});
