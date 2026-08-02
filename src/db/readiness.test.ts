// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  createNitroxCertification,
  listShopNitroxCertifications,
  reviewNitroxCertification,
} from "./nitrox";
import {
  archiveCertification,
  archiveSpecialtyCertification,
  createCertification,
  createSpecialtyCertification,
  getBookingReadiness,
  getBookingReadinessDetail,
  listShopCertifications,
  listShopSpecialtyCertifications,
  listTripReadiness,
  listTripsReadiness,
  restoreCertification,
  restoreSpecialtyCertification,
  reviewCertification,
  reviewSpecialtyCertification,
  upsertTripRequirements,
} from "./readiness";
import type { DiveSpecialty } from "./schema";
import { diveSites, specialtyCertifications } from "./schema";
import { getTripRoster, listTripDives, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

async function readinessContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [rosterEntry] = await getTripRoster(db, shop.id, reef.id);
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

  it("carries a signed waiver across a diver's other bookings (sign once)", async () => {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    const email = rosterEntry.person.email;
    if (!email) throw new Error("demo diver has no email to rebook under");

    // The same diver grabs a spot on a second, non-course trip.
    const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const other = upcoming.find(
      (trip) => trip.id !== reef.id && !trip.course && trip.booked < trip.capacity,
    );
    if (!other) throw new Error("expected a second open non-course trip in the seed");
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: other.id,
      fullName: rosterEntry.person.fullName,
      email,
    });
    if (!booked.ok) throw new Error(`second booking failed: ${booked.reason}`);

    // Isolate the waiver gate on the second trip so the assertion is unambiguous.
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: other.id,
      requiresWaiver: true,
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });
    expect((await getBookingReadiness(db, shop.id, booked.bookingId))?.blockers).toContainEqual(
      expect.objectContaining({ code: "waiver_not_sent" }),
    );

    // Sign the waiver once, on the reef booking.
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: rosterEntry.booking.id,
    });
    if (!issued.ok) throw new Error(`waiver issue failed: ${issued.reason}`);
    const completion = await completeWaiver(db, issued.token, {
      signerName: rosterEntry.person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    expect(completion).toMatchObject({ ok: true, status: "completed" });

    // The second booking is now covered without ever being sent its own link.
    const second = await getBookingReadiness(db, shop.id, booked.bookingId);
    expect(second?.blockers).not.toContainEqual(
      expect.objectContaining({ code: "waiver_not_sent" }),
    );
    expect(second).toEqual({ status: "ready", blockers: [] });
  });

  it("resolves a booking's full readiness detail for the no-login diver page", async () => {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    const detail = await getBookingReadinessDetail(db, rosterEntry.booking.id);
    expect(detail).not.toBeNull();
    expect(detail?.shop.name).toBe(shop.name);
    expect(detail?.trip.title).toBe(reef.title);
    expect(detail?.person.fullName).toBe(rosterEntry.person.fullName);
    expect(detail?.cancelled).toBe(false);
    // The same fail-closed engine result staff and the manifest see.
    expect(detail?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "waiver_not_sent" }),
    );
  });

  it("fails closed to null for an unknown booking id", async () => {
    const { db } = await readinessContext();
    expect(await getBookingReadinessDetail(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
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
      requiresPayment: false,
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

  it("opens a depth gate only when a staffer says they've seen the imported card", async () => {
    // The whole point of H-23's posture: an imported specialty card is verified,
    // and the deep dive still waits. H-24 adds that the tap which opens it has to
    // assert something — a bare click on a spreadsheet-sourced card is what the
    // posture exists to prevent.
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: null,
      requiredSpecialties: ["deep"],
      requiresNitrox: false,
      requiresPayment: false,
    });
    const [imported] = await db
      .insert(specialtyCertifications)
      .values({
        shopId: shop.id,
        personId: rosterEntry.person.id,
        agency: "padi",
        specialty: "deep",
        identifier: "PADI-IMPORTED-DEEP",
        status: "verified",
        importedAt: new Date("2026-07-01T00:00:00Z"),
        importedFromLabel: "Reef Runners",
      })
      .returning();

    // Verified, imported, unconfirmed → the deep dive is blocked, and the blocker
    // names the fix rather than the fault.
    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).toContainEqual(expect.objectContaining({ code: "specialty_import_unconfirmed" }));

    // A confirm with no attestation is refused, and the gate stays shut.
    expect(
      await reviewSpecialtyCertification(db, {
        shopId: shop.id,
        certificationId: imported.id,
        status: "verified",
      }),
    ).toEqual({ ok: false, reason: "card_sighting_required" });
    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).toContainEqual(expect.objectContaining({ code: "specialty_import_unconfirmed" }));

    // With the attestation the gate opens, and the row records what was asserted.
    const confirmed = await reviewSpecialtyCertification(db, {
      shopId: shop.id,
      certificationId: imported.id,
      status: "verified",
      cardSighted: true,
    });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.certification.reviewNote).toContain("seen in person");
    }
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
      requiresPayment: false,
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

    // A card this shop captured itself needs no attestation — "Mark certified"
    // already means a staffer looked the number up with the agency (H-24).
    const reviewed = await reviewSpecialtyCertification(db, {
      shopId: shop.id,
      certificationId: pending.id,
      status: "verified",
    });
    expect(reviewed.ok).toBe(true);
    expect(await getBookingReadiness(db, shop.id, rosterEntry.booking.id)).toEqual({
      status: "ready",
      blockers: [],
    });
  });

  it("gates a required nitrox card, fail-closed, on a trip requirement", async () => {
    const { db, shop, reef } = await readinessContext();
    // Pick a booked diver who has no nitrox card on file yet.
    const roster = await getTripRoster(db, shop.id, reef.id);
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
      requiresPayment: false,
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

  it("archives a level card so it stops counting and drops out of the shop list", async () => {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: "rescue",
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESCUE-DELETE",
    });
    if (!card) throw new Error("expected certification to insert");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });
    expect(await getBookingReadiness(db, shop.id, rosterEntry.booking.id)).toEqual({
      status: "ready",
      blockers: [],
    });

    expect(await archiveCertification(db, { shopId: shop.id, certificationId: card.id })).toBe(
      true,
    );
    const after = await getBookingReadiness(db, shop.id, rosterEntry.booking.id);
    // With the rescue card archived the diver falls back to their lower seeded
    // card, so readiness re-blocks — an archived card no longer counts.
    expect(after?.status).toBe("blocked");
    expect(after?.blockers).toContainEqual(
      expect.objectContaining({ code: "certification_insufficient" }),
    );
    // It leaves the active shop list…
    expect(await listShopCertifications(db, shop.id)).not.toContainEqual(
      expect.objectContaining({ certification: expect.objectContaining({ id: card.id }) }),
    );
    // …but the archived slot is freed, so the same card number can be recaptured.
    const recaptured = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESCUE-DELETE",
    });
    expect(recaptured).not.toBeNull();
  });

  it("restores an archived level card, but refuses once its number is re-used", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESTORE-1",
    });
    if (!card) throw new Error("expected certification to insert");
    expect(await archiveCertification(db, { shopId: shop.id, certificationId: card.id })).toBe(
      true,
    );

    // The undo path: the same archived card comes back into the shop list.
    expect(await restoreCertification(db, { shopId: shop.id, certificationId: card.id })).toBe(
      true,
    );
    expect(await listShopCertifications(db, shop.id)).toContainEqual(
      expect.objectContaining({ certification: expect.objectContaining({ id: card.id }) }),
    );

    // Archive it again, then re-capture the same number as a fresh card. Restoring
    // the old one now would collide on the partial unique index, so it's refused.
    expect(await archiveCertification(db, { shopId: shop.id, certificationId: card.id })).toBe(
      true,
    );
    const recaptured = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESTORE-1",
    });
    if (!recaptured) throw new Error("expected recapture to insert");
    expect(await restoreCertification(db, { shopId: shop.id, certificationId: card.id })).toBe(
      false,
    );
    // A restore through another shop's id is likewise refused.
    expect(
      await restoreCertification(db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        certificationId: recaptured.id,
      }),
    ).toBe(false);
  });

  it("refuses a level card whose identifier only differs by case from a live one (CR-009)", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "ab1234",
    });
    expect(card).not.toBeNull();
    const duplicate = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "AB1234",
    });
    expect(duplicate).toBeNull();
  });

  it("restores an archived level card even when the live conflict differs only by case", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "cd5678",
    });
    if (!card) throw new Error("expected certification to insert");
    expect(await archiveCertification(db, { shopId: shop.id, certificationId: card.id })).toBe(
      true,
    );
    const recaptured = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "CD5678",
    });
    expect(recaptured).not.toBeNull();
    // The archived card's number is live again under a different case — restoring
    // it would collide on the case-insensitive index, so it's refused.
    expect(await restoreCertification(db, { shopId: shop.id, certificationId: card.id })).toBe(
      false,
    );
  });

  it("refuses a specialty card whose identifier only differs by case from a live one (CR-009)", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const card = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      specialty: "wreck",
      identifier: "wr9999",
    });
    expect(card).not.toBeNull();
    const duplicate = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      specialty: "wreck",
      identifier: "WR9999",
    });
    expect(duplicate).toBeNull();
  });

  it("restores an archived specialty card", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const card = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      specialty: "wreck",
      identifier: "PADI-WRECK-RESTORE",
    });
    if (!card) throw new Error("expected specialty to insert");
    expect(
      await archiveSpecialtyCertification(db, { shopId: shop.id, certificationId: card.id }),
    ).toBe(true);
    expect(
      await restoreSpecialtyCertification(db, { shopId: shop.id, certificationId: card.id }),
    ).toBe(true);
    expect(await listShopSpecialtyCertifications(db, shop.id)).toContainEqual(
      expect.objectContaining({ certification: expect.objectContaining({ id: card.id }) }),
    );
    // Restoring a card that was never archived is a no-op false.
    expect(
      await restoreSpecialtyCertification(db, { shopId: shop.id, certificationId: card.id }),
    ).toBe(false);
  });

  it("refuses to archive a level card through another shop's id", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-OW-KEEP",
    });
    if (!card) throw new Error("expected certification to insert");
    expect(
      await archiveCertification(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        certificationId: card.id,
      }),
    ).toBe(false);
    expect(await listShopCertifications(db, shop.id)).toContainEqual(
      expect.objectContaining({ certification: expect.objectContaining({ id: card.id }) }),
    );
  });

  it("archives a specialty card, shop-scoped", async () => {
    const { db, shop, rosterEntry } = await readinessContext();
    const card = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      specialty: "wreck",
      identifier: "PADI-WRECK-DELETE",
    });
    if (!card) throw new Error("expected specialty certification to insert");
    expect(
      await archiveSpecialtyCertification(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        certificationId: card.id,
      }),
    ).toBe(false);
    expect(
      await archiveSpecialtyCertification(db, { shopId: shop.id, certificationId: card.id }),
    ).toBe(true);
    const remaining = await listShopSpecialtyCertifications(db, shop.id);
    expect(remaining.map((row) => row.certification.id)).not.toContain(card.id);
  });
});

describe("depth advisory (H-08 — a warning, never a gate)", () => {
  /**
   * The seeded two-tank trip visits more than one site, so these helpers set
   * every site the shop owns — otherwise a sibling site's depth leaks into the
   * result and the assertion is about the wrong number.
   */
  async function withAllSiteDepths(meters: number | null) {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await db.update(diveSites).set({ maxDepthMeters: meters }).where(eq(diveSites.shopId, shop.id));
    // A verified Open Water card, so there is a ceiling (18 m) to measure at all.
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: rosterEntry.person.id,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-DEPTH-OW",
    });
    if (!card) throw new Error("expected certification to insert");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });
    const rows = await listTripReadiness(db, shop.id, reef.id);
    const diver = rows.find((row) => row.booking.id === rosterEntry.booking.id);
    if (!diver) throw new Error("demo booking missing from readiness");
    return { db, shop, reef, rosterEntry, diver };
  }

  it("stays quiet when every site on the trip is within the diver's ceiling", async () => {
    const { diver } = await withAllSiteDepths(12);
    expect(diver.depthAdvisory).toMatchObject({ status: "within", siteDepth: 12, unit: "meters" });
  });

  it("warns when the trip goes deeper than the card trains for", async () => {
    const { diver } = await withAllSiteDepths(30);
    expect(diver.depthAdvisory).toMatchObject({
      status: "exceeds",
      limitDepth: 18,
      siteDepth: 30,
      unit: "meters",
      basis: "certification",
    });
  });

  it("never turns that warning into a blocker — the diver still boards", async () => {
    // The whole decision in one assertion: a 30 m trip under an 18 m card
    // produces an advisory and *no* readiness blocker. An instructor may be
    // keeping this diver shallower on purpose.
    const { diver } = await withAllSiteDepths(30);
    expect(diver.depthAdvisory.status).toBe("exceeds");
    expect(diver.readiness.blockers.some((blocker) => blocker.code.includes("depth"))).toBe(false);
  });

  it("says nothing at all when no site on the trip has a depth on file", async () => {
    const { diver } = await withAllSiteDepths(null);
    expect(diver.depthAdvisory).toEqual({ status: "unknown" });
  });

  it("takes the deepest site the trip visits, not just the first", async () => {
    // The two-tank case the naive version gets wrong: dive one is shallow and
    // dive two is the deep one, so reading only the primary site goes quiet on
    // exactly the trip that needed the warning.
    const { db, shop, reef, rosterEntry } = await withAllSiteDepths(10);
    const dives = await listTripDives(db, shop.id, reef.id);
    const deeper = dives
      .map(({ dive }) => dive.diveSiteId)
      .find((id) => id && id !== reef.diveSiteId);
    if (!deeper) throw new Error("seeded two-tank trip should visit a second site");
    await db
      .update(diveSites)
      .set({ maxDepthMeters: 35 })
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.id, deeper)));

    const rows = await listTripReadiness(db, shop.id, reef.id);
    const diver = rows.find((row) => row.booking.id === rosterEntry.booking.id);
    expect(diver?.depthAdvisory).toMatchObject({ status: "exceeds", siteDepth: 35 });
  });
});

describe("site cert gate across the whole itinerary (DOM-C1)", () => {
  /**
   * Isolates the site gate on the seeded two-tank trip: the trip's own
   * requirement demands nothing, every site the shop owns demands nothing, and
   * then only the site of *dive two* is given a requirement. Anything the
   * readiness engine then reports came from a site that is not the trip's
   * primary one — which is exactly the site the gate used to never read.
   */
  async function withSecondSiteRequirement(requirement: {
    minimumCertificationLevel?: "advanced_open_water" | "rescue";
    requiredSpecialties?: DiveSpecialty[];
    requiresNitrox?: boolean;
  }) {
    const { db, shop, reef, rosterEntry } = await readinessContext();
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: reef.id,
      requiresWaiver: false,
      minimumCertificationLevel: null,
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });
    await db
      .update(diveSites)
      .set({ minimumCertificationLevel: null, requiredSpecialties: [], requiresNitrox: false })
      .where(eq(diveSites.shopId, shop.id));

    const dives = await listTripDives(db, shop.id, reef.id);
    const secondSiteId = dives
      .map(({ dive }) => dive.diveSiteId)
      .find((id) => id && id !== reef.diveSiteId);
    if (!secondSiteId) throw new Error("seeded two-tank trip should visit a second site");
    if (Object.keys(requirement).length > 0) {
      await db
        .update(diveSites)
        .set(requirement)
        .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.id, secondSiteId)));
    }
    return { db, shop, reef, rosterEntry, secondSiteId };
  }

  /** A verified Open Water card, so a raised level reads "insufficient", not "missing". */
  async function verifiedOpenWaterCard(
    db: Awaited<ReturnType<typeof readinessContext>>["db"],
    shopId: string,
    personId: string,
  ) {
    const card = await createCertification(db, {
      shopId,
      personId,
      agency: "padi",
      level: "open_water",
      identifier: `PADI-SITE-GATE-${personId.slice(0, 8)}`,
    });
    if (!card) throw new Error("expected certification to insert");
    await reviewCertification(db, { shopId, certificationId: card.id, status: "verified" });
  }

  it("blocks an Open Water diver when dive two's site needs Advanced, not just dive one's", async () => {
    const { db, shop, reef, rosterEntry } = await withSecondSiteRequirement({
      minimumCertificationLevel: "advanced_open_water",
    });
    await verifiedOpenWaterCard(db, shop.id, rosterEntry.person.id);

    const readiness = await getBookingReadiness(db, shop.id, rosterEntry.booking.id);
    expect(readiness?.blockers).toContainEqual(
      expect.objectContaining({ code: "certification_insufficient" }),
    );
    // And the batch path agrees — it built its own primary-only query.
    const [batch] = (await listTripsReadiness(db, shop.id, [reef.id])).filter(
      (row) => row.booking.id === rosterEntry.booking.id,
    );
    expect(batch?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "certification_insufficient" }),
    );
  });

  it("demands a specialty that only dive two's site asks for", async () => {
    const { db, shop, reef, rosterEntry } = await withSecondSiteRequirement({
      requiredSpecialties: ["deep"],
    });

    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).toContainEqual(expect.objectContaining({ code: "specialty_missing" }));
    const [batch] = (await listTripsReadiness(db, shop.id, [reef.id])).filter(
      (row) => row.booking.id === rosterEntry.booking.id,
    );
    expect(batch?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "specialty_missing" }),
    );
  });

  it("demands nitrox when only dive two's site runs on it", async () => {
    const { db, shop, reef } = await withSecondSiteRequirement({ requiresNitrox: true });
    // A booked diver with no nitrox card on file, so the blocker is unambiguous.
    const roster = await getTripRoster(db, shop.id, reef.id);
    const nitroxHolders = new Set(
      (await listShopNitroxCertifications(db, shop.id)).map((r) => r.certification.personId),
    );
    const entry = roster.find((r) => !nitroxHolders.has(r.person.id));
    if (!entry) throw new Error("expected a booked diver without a nitrox card");

    expect((await getBookingReadiness(db, shop.id, entry.booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "nitrox_missing" }),
    );
    const [batch] = (await listTripsReadiness(db, shop.id, [reef.id])).filter(
      (row) => row.booking.id === entry.booking.id,
    );
    expect(batch?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "nitrox_missing" }),
    );
  });

  it("unions the sites rather than letting one of them win", async () => {
    // The batch path built its map with `new Map(rows.map(...))`, which is
    // last-write-wins per trip: with a requirement on each site, whichever row
    // arrived last silently erased the other.
    const { db, shop, reef, rosterEntry } = await withSecondSiteRequirement({
      requiredSpecialties: ["deep"],
    });
    if (!reef.diveSiteId) throw new Error("seeded two-tank trip should have a primary site");
    await db
      .update(diveSites)
      .set({ requiredSpecialties: ["wreck"] })
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.id, reef.diveSiteId)));

    const expected = [
      expect.objectContaining({ code: "specialty_missing", params: { specialty: "deep" } }),
      expect.objectContaining({ code: "specialty_missing", params: { specialty: "wreck" } }),
    ];
    const readiness = await getBookingReadiness(db, shop.id, rosterEntry.booking.id);
    expect(readiness?.blockers).toEqual(expect.arrayContaining(expected));
    const [batch] = (await listTripsReadiness(db, shop.id, [reef.id])).filter(
      (row) => row.booking.id === rosterEntry.booking.id,
    );
    expect(batch?.readiness.blockers).toEqual(expect.arrayContaining(expected));
  });

  it("still reads a requirement on the primary site when no other site has one", async () => {
    const { db, shop, reef, rosterEntry } = await withSecondSiteRequirement({});
    if (!reef.diveSiteId) throw new Error("seeded two-tank trip should have a primary site");
    await db
      .update(diveSites)
      .set({ minimumCertificationLevel: "rescue" })
      .where(and(eq(diveSites.shopId, shop.id), eq(diveSites.id, reef.diveSiteId)));
    await verifiedOpenWaterCard(db, shop.id, rosterEntry.person.id);

    expect(
      (await getBookingReadiness(db, shop.id, rosterEntry.booking.id))?.blockers,
    ).toContainEqual(expect.objectContaining({ code: "certification_insufficient" }));
  });
});
