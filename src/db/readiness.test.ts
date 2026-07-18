// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import {
  createNitroxCertification,
  listShopNitroxCertifications,
  reviewNitroxCertification,
} from "./nitrox";
import { getShopBySlug, getTripRoster, upcomingTripsWithCounts } from "./queries";
import {
  createCertification,
  createSpecialtyCertification,
  getBookingReadiness,
  listShopCertifications,
  listShopSpecialtyCertifications,
  listTripReadiness,
  reviewCertification,
  reviewSpecialtyCertification,
  upsertTripRequirements,
  verifyCertificationWithAgency,
} from "./readiness";
import { certifications as certificationsTable } from "./schema";
import { seedDemo } from "./seed";

async function readinessContext() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [rosterEntry] = await getTripRoster(db, reef.id);
  if (!rosterEntry) throw new Error("demo booking missing");
  return { db, shop, reef, rosterEntry };
}

describe("trip readiness (in-memory PGlite)", () => {
  it("shares a fail-closed waiver/certification result for a booking and its trip roster", async () => {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    const roster = await listTripReadiness(db, shop.id, reef.id);
    const diver = roster.find((row) => row.booking.id === rosterEntry.booking.id);
    expect(diver?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "waiver_not_sent" }),
    );

    const oneBooking = await getBookingReadiness(db, shop.id, rosterEntry.booking.id);
    expect(oneBooking).toEqual(diver?.readiness);
  });

  it("requires review before new card evidence can satisfy a raised trip requirement", async () => {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: "rescue",
      requiredSpecialties: [],
      requiresNitrox: false,
    });
    const pending = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESCUE-123",
      cardImageUrl: "https://cards.example/rescue-123.jpg",
    });
    if (!pending) throw new Error("expected certification to insert");

    const before = await getBookingReadiness(db, shop.id, rosterEntry.booking.id);
    expect(before?.blockers).toContainEqual(
      expect.objectContaining({ code: "certification_pending" }),
    );
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

  it("gates a required specialty on a verified specialty card, fail-closed", async () => {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: null,
      requiredSpecialties: ["deep"],
      requiresNitrox: false,
    });
    const missing = await getBookingReadiness(db, shop.id, rosterEntry.booking.id);
    expect(missing?.blockers).toContainEqual(
      expect.objectContaining({ code: "specialty_missing" }),
    );

    const pending = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      specialty: "deep",
      identifier: "PADI-DEEP-77",
    });
    if (!pending) throw new Error("expected specialty certification to insert");
    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).toContainEqual(expect.objectContaining({ code: "specialty_pending" }));

    await reviewSpecialtyCertification(db, {
      shopId: shop.id,
      certificationId: pending.id,
      status: "verified",
    });
    expect(await getBookingReadiness(db, shop.id, rosterEntry.booking.id)).toEqual({
      status: "ready",
      blockers: [],
    });
  });

  it("gates a required nitrox card, fail-closed, on a trip requirement", async () => {
    const { db, shop, reef } = await readinessContext();
    // Pick a booked diver who has no nitrox card on file yet.
    const roster = await getTripRoster(db, reef.id);
    const nitroxHolders = new Set(
      (await listShopNitroxCertifications(db, shop.id)).map((r) => r.certification.personId),
    );
    const entry = roster.find((r) => !nitroxHolders.has(r.person.id));
    if (!entry) throw new Error("expected a booked diver without a nitrox card");

    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: true,
    });
    expect((await getBookingReadiness(db, shop.id, entry.booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "nitrox_missing" }),
    );

    const pending = await createNitroxCertification(db, {
      shopId: shop.id,
      personId: entry.person.id,
      agency: "padi",
      identifier: "EANX-READY-9",
    });
    if (!pending) throw new Error("expected nitrox certification to insert");
    expect((await getBookingReadiness(db, shop.id, entry.booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "nitrox_pending" }),
    );

    await reviewNitroxCertification(db, {
      shopId: shop.id,
      certificationId: pending.id,
      status: "verified",
    });
    expect(await getBookingReadiness(db, shop.id, entry.booking.id)).toEqual({
      status: "ready",
      blockers: [],
    });
  });

  it("auto-verifies on an agency match but only warns on a miss", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const pending = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-CHECK-1",
    });
    if (!pending) throw new Error("expected certification to insert");

    // A confirmed agency match verifies the card and records the source.
    const matched = await verifyCertificationWithAgency(db, shop.id, pending.id, {
      verify: async () => ({ status: "verified", reference: "AG-1" }),
    });
    expect(matched).toBe("verified");
    let [row] = await db
      .select()
      .from(certificationsTable)
      .where(eq(certificationsTable.id, pending.id));
    expect(row?.status).toBe("verified");
    expect(row?.reviewNote).toContain("PADI");

    // A not_found result is assistive only: it warns, never auto-rejects.
    const other = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "ssi",
      level: "open_water",
      identifier: "SSI-CHECK-2",
    });
    if (!other) throw new Error("expected certification to insert");
    const missed = await verifyCertificationWithAgency(db, shop.id, other.id, {
      verify: async () => ({ status: "not_found" }),
    });
    expect(missed).toBe("not_found");
    [row] = await db.select().from(certificationsTable).where(eq(certificationsTable.id, other.id));
    expect(row?.status).toBe("pending");
    expect(row?.reviewNote).toContain("could not find");
  });

  it("does not leak specialty certifications across shops", async () => {
    const { db, rosterEntry } = await readinessContext();
    expect(
      await createSpecialtyCertification(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        personId: rosterEntry.person.id,
        agency: "padi",
        specialty: "wreck",
        identifier: "NOT-OURS-SPECIALTY",
      }),
    ).toBeNull();
    expect(
      await listShopSpecialtyCertifications(db, "00000000-0000-4000-8000-000000000000"),
    ).toEqual([]);
  });

  it("does not leak certifications across shops", async () => {
    const { db, rosterEntry } = await readinessContext();
    expect(
      await createCertification(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        personId: rosterEntry.person.id,
        agency: "padi",
        level: "open_water",
        identifier: "NOT-OURS",
      }),
    ).toBeNull();
    expect(await listShopCertifications(db, "00000000-0000-4000-8000-000000000000")).toEqual([]);
  });
});
