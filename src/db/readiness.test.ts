// @vitest-environment node
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
  createCertification,
  createSpecialtyCertification,
  getBookingReadiness,
  getBookingReadinessDetail,
  listShopCertifications,
  listShopSpecialtyCertifications,
  listTripReadiness,
  reviewCertification,
  reviewSpecialtyCertification,
  upsertTripRequirements,
} from "./readiness";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

async function readinessContext() {
  const { db, shop } = await seededShopContext();
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
});
