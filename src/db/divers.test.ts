// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ANONYMIZED_PERSON_NAME, REDACTED_TEXT } from "@/lib/anonymization";
import { computeWaiverIntegrityHash, verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import {
  createDiver,
  deleteDiver,
  getDiverProfile,
  listBookableDivers,
  listDiverSummaries,
  restoreDiver,
  updateDiver,
} from "./divers";
import { saveRentalFit } from "./rental-fit";
import {
  activityEvents,
  bookingCapabilities,
  bookingPayments,
  bookings,
  calendarFeeds,
  certifications,
  courseInquiries,
  courses,
  internalNotes,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  mediaDeletionAttempts,
  nitroxCertifications,
  notificationDeliveries,
  notificationSendQueue,
  orders,
  people,
  personCourtesyEmailUnsubscribeTokens,
  personRoles,
  priorVisits,
  recapPhotos,
  rentalFitProfiles,
  rollCallEvents,
  shops,
  specialtyCertifications,
  tripReviews,
  tripWaitlistEntries,
  userAccounts,
  waiverRecords,
} from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

describe("person-first diver records", () => {
  it("composes cards, fit, and history from one diver record", async () => {
    const { db, shop } = await seededShopContext();

    // Search explicitly rather than relying on the default (alphabetically
    // sorted, page-sized) listing — the extended roster is well past one page.
    const { divers: summaries } = await listDiverSummaries(db, shop.id, { query: "Priya Sharma" });
    const priya = summaries.find((row) => row.person.fullName === "Priya Sharma");
    expect(priya).toMatchObject({ certificationCount: 1, pendingCertificationCount: 0 });
    if (!priya) throw new Error("seed diver missing");

    const profile = await saveRentalFit(db, {
      shopId: shop.id,
      personId: priya.person.id,
      rentsBcd: true,
      rentsRegulator: false,
      rentsWetsuit: true,
      rentsMaskFins: true,
      rentsWeights: true,
      rentsDiveComputer: false,
      rentsGopro: false,
      bcdSize: "M",
      wetsuitSize: "3 mm / M",
      finSize: "L",
      weightPreference: "12 lb",
    });
    expect(profile).toMatchObject({ bcdSize: "M", wetsuitSize: "3 mm / M" });

    const detail = await getDiverProfile(db, shop.id, priya.person.id);
    expect(detail?.rentalFit).toMatchObject({ bcdSize: "M", finSize: "L", rentsRegulator: false });
    expect(detail?.certifications).toHaveLength(1);
  });

  it("can add a returning diver before a booking and rejects staff-only records", async () => {
    const { db, shop } = await seededShopContext();

    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Returning Riley",
      email: "riley@example.com",
      phone: "+1 305 555 0199",
    });
    expect(diver).toMatchObject({ fullName: "Returning Riley", email: "riley@example.com" });
    if (!diver) throw new Error("diver insert failed");
    expect(
      await createDiver(db, {
        shopId: shop.id,
        fullName: "Duplicate Riley",
        email: "RILEY@example.com",
      }),
    ).toBeNull();

    const updated = await updateDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Returning Riley Updated",
      email: "riley@example.com",
      phone: "555",
      diveInsurance: "  DAN #12345  ",
    });
    expect(updated?.fullName).toBe("Returning Riley Updated");
    // The dive-insurance field is trimmed and persisted; blanking it clears it.
    expect(updated?.diveInsurance).toBe("DAN #12345");
    const cleared = await updateDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Returning Riley Updated",
      email: "riley@example.com",
      diveInsurance: "   ",
    });
    expect(cleared?.diveInsurance).toBeNull();

    const staff = (await listDiverSummaries(db, shop.id)).divers.find(
      (row) => row.person.fullName === "Dana Reyes",
    );
    expect(staff).toBeUndefined();
  });

  // Task 144 (safety-adjacent — this prints on the manifest): staff can now
  // type an emergency contact straight onto the diver record, not just "ask
  // at the counter" with nowhere to record it.
  describe("updateDiver emergency contact fields", () => {
    it("writes both fields, leaves them untouched when omitted, and clears them on blank", async () => {
      const { db, shop } = await seededShopContext();
      const diver = await createDiver(db, { shopId: shop.id, fullName: "Contact Casey" });
      if (!diver) throw new Error("diver insert failed");

      const withContact = await updateDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        fullName: "Contact Casey",
        emergencyContactName: "  Robin Casey  ",
        emergencyContactPhone: "  +1 305 555 0177  ",
      });
      expect(withContact).toMatchObject({
        emergencyContactName: "Robin Casey",
        emergencyContactPhone: "+1 305 555 0177",
      });

      // Undefined (the field simply wasn't part of this save) leaves the
      // existing value alone — a staffer editing only the phone number must
      // never silently wipe the name.
      const untouched = await updateDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        fullName: "Contact Casey",
      });
      expect(untouched).toMatchObject({
        emergencyContactName: "Robin Casey",
        emergencyContactPhone: "+1 305 555 0177",
      });

      // "" is an explicit clear — unlike the diver-facing capture on
      // /ready and /waivers (saveBookingEmergencyContact), a staffer
      // correcting a wrong entry here must be able to blank it out.
      const cleared = await updateDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        fullName: "Contact Casey",
        emergencyContactName: "   ",
        emergencyContactPhone: "   ",
      });
      expect(cleared).toMatchObject({
        emergencyContactName: null,
        emergencyContactPhone: null,
      });
    });

    it("never writes an emergency contact onto another shop's diver", async () => {
      const { db, shop } = await seededShopContext();
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Other Shop", slug: "other-shop-divers-contact-test", timezone: "UTC" })
        .returning();
      if (!otherShop) throw new Error("second shop insert failed");
      const diver = await createDiver(db, { shopId: shop.id, fullName: "Cross Shop Devon" });
      if (!diver) throw new Error("diver insert failed");

      const result = await updateDiver(db, {
        shopId: otherShop.id,
        personId: diver.id,
        fullName: "Cross Shop Devon",
        emergencyContactName: "Should Not Land",
        emergencyContactPhone: "+1 000 000 0000",
      });
      expect(result).toBeNull();

      const [row] = await db.select().from(people).where(eq(people.id, diver.id));
      expect(row?.emergencyContactName).toBeNull();
      expect(row?.emergencyContactPhone).toBeNull();
    });
  });

  it("soft-deletes a diver without erasing their record", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Archived Alex",
      email: "alex@example.com",
    });
    if (!diver) throw new Error("diver insert failed");

    expect(await deleteDiver(db, shop.id, diver.id)).toBe(true);
    expect(
      (await listDiverSummaries(db, shop.id)).divers.some((row) => row.person.id === diver.id),
    ).toBe(false);
    expect(await getDiverProfile(db, shop.id, diver.id)).toBeNull();
    expect(await restoreDiver(db, shop.id, diver.id)).toBe(true);
    expect(
      (await listDiverSummaries(db, shop.id)).divers.some((row) => row.person.id === diver.id),
    ).toBe(true);
  });

  it("frees a deleted diver's email for a genuinely new person, and refuses to restore into a collision (CR-008)", async () => {
    const { db, shop } = await seededShopContext();
    const original = await createDiver(db, {
      shopId: shop.id,
      fullName: "Archived Alex",
      email: "alex@example.com",
    });
    if (!original) throw new Error("diver insert failed");
    expect(await deleteDiver(db, shop.id, original.id)).toBe(true);

    // The email is free while Alex's record is soft-deleted — a genuinely
    // new person can take it.
    const replacement = await createDiver(db, {
      shopId: shop.id,
      fullName: "New Alex",
      email: "Alex@Example.com",
    });
    expect(replacement).not.toBeNull();
    expect(replacement?.id).not.toBe(original.id);

    // Restoring the original would now collide with the replacement's live
    // row — refused, not a silent identity clobber.
    expect(await restoreDiver(db, shop.id, original.id)).toBe(false);
  });
});

describe("roster search and pagination", () => {
  it("searches server-side by name, email, or phone", async () => {
    const { db, shop } = await seededShopContext();

    const byName = await listDiverSummaries(db, shop.id, { query: "priya" });
    expect(byName.divers.map((row) => row.person.fullName)).toEqual(["Priya Sharma"]);
    expect(byName.total).toBe(1);

    const byEmail = await listDiverSummaries(db, shop.id, { query: "priya.sharma@example" });
    expect(byEmail.divers).toHaveLength(1);

    const nobody = await listDiverSummaries(db, shop.id, { query: "zzz-no-such-diver" });
    expect(nobody.divers).toHaveLength(0);
    expect(nobody.total).toBe(0);
    expect(nobody.nextCursor).toBeNull();
  });

  it("filters the roster by saved-view facet (missing contact, insured)", async () => {
    const { db, shop } = await seededShopContext();
    const target = (await listDiverSummaries(db, shop.id)).divers[0]?.person;
    if (!target) throw new Error("expected seeded divers");

    // Start the target with no contact so the baseline "missing contact" count
    // deterministically includes them, then measure it.
    await db
      .update(people)
      .set({ emergencyContactName: null, emergencyContactPhone: null })
      .where(eq(people.id, target.id));
    const baselineMissing = (await listDiverSummaries(db, shop.id, { filter: "missing_contact" }))
      .total;
    expect(baselineMissing).toBeGreaterThan(0);

    // Now complete the target's contact and give them dive insurance.
    await updateDiver(db, {
      shopId: shop.id,
      personId: target.id,
      fullName: target.fullName,
      email: target.email ?? "",
      phone: target.phone ?? "",
      diveInsurance: "DAN #999",
    });
    await db
      .update(people)
      .set({ emergencyContactName: "Kin Ono", emergencyContactPhone: "+1 305 555 0000" })
      .where(eq(people.id, target.id));

    // Insurance is a new column defaulting null, so only the target carries it.
    const insured = await listDiverSummaries(db, shop.id, { filter: "insured" });
    expect(insured.divers.map((row) => row.person.id)).toEqual([target.id]);
    expect(insured.total).toBe(1);

    // With a full contact now on file, the target leaves the "missing" view.
    const missing = await listDiverSummaries(db, shop.id, { filter: "missing_contact" });
    expect(missing.divers.some((row) => row.person.id === target.id)).toBe(false);
    expect(missing.total).toBe(baselineMissing - 1);
  });

  it("pages with a keyset cursor and never repeats or skips a diver", async () => {
    const { db, shop } = await seededShopContext();

    // The extended roster is well past DIVER_PAGE_SIZE, so fetch a limit large
    // enough to get every diver back in one page as ground truth.
    const all = await listDiverSummaries(db, shop.id, { limit: 1000 });
    expect(all.nextCursor).toBeNull();
    expect(all.total).toBe(all.divers.length);

    const seen: string[] = [];
    let cursor: string | undefined;
    const maxHops = Math.ceil(all.divers.length / 3) + 1;
    for (let hops = 0; hops < maxHops; hops++) {
      const page = await listDiverSummaries(db, shop.id, { cursor, limit: 3 });
      expect(page.divers.length).toBeLessThanOrEqual(3);
      seen.push(...page.divers.map((row) => row.person.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.divers.map((row) => row.person.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("treats a mangled cursor as the first page", async () => {
    const { db, shop } = await seededShopContext();
    const all = await listDiverSummaries(db, shop.id);
    const mangled = await listDiverSummaries(db, shop.id, { cursor: "not-a-real-cursor" });
    expect(mangled.divers.map((row) => row.person.id)).toEqual(
      all.divers.map((row) => row.person.id),
    );
  });
});

describe("listBookableDivers (returning-diver picker)", () => {
  async function openTrip(db: AppDb, shopId: string) {
    const trips = await upcomingTripsWithCounts(db, shopId);
    const trip = trips.find((t) => t.booked < t.capacity);
    if (!trip) throw new Error("no open seeded trip");
    return trip;
  }

  it("returns nothing for an empty query", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await openTrip(db, shop.id);
    expect(await listBookableDivers(db, shop.id, trip.id, { query: "  " })).toEqual([]);
  });

  it("finds a returning diver and carries their rental fit", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await openTrip(db, shop.id);
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Marina Vega",
      email: "marina@example.com",
    });
    if (!diver) throw new Error("diver setup failed");
    await saveRentalFit(db, {
      shopId: shop.id,
      personId: diver.id,
      rentsBcd: true,
      rentsRegulator: true,
      rentsWetsuit: true,
      rentsMaskFins: true,
      rentsWeights: true,
      rentsDiveComputer: false,
      rentsGopro: false,
      wetsuitSize: "5 mm / M",
    });

    const matches = await listBookableDivers(db, shop.id, trip.id, { query: "marina" });
    expect(matches.map((m) => m.person.fullName)).toEqual(["Marina Vega"]);
    expect(matches[0]?.rentalFit).toMatchObject({ wetsuitSize: "5 mm / M" });
  });

  it("excludes a diver already holding an active seat on the trip", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await openTrip(db, shop.id);
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Booked Bianca",
      email: "bianca@example.com",
    });
    if (!diver) throw new Error("diver setup failed");

    expect(
      (await listBookableDivers(db, shop.id, trip.id, { query: "bianca" })).map(
        (m) => m.person.fullName,
      ),
    ).toEqual(["Booked Bianca"]);

    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      personId: diver.id,
    });
    expect(booked.ok).toBe(true);

    expect(await listBookableDivers(db, shop.id, trip.id, { query: "bianca" })).toEqual([]);
  });

  it("omits soft-deleted divers", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await openTrip(db, shop.id);
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Gone Gary",
      email: "gary@example.com",
    });
    if (!diver) throw new Error("diver setup failed");
    await deleteDiver(db, shop.id, diver.id);
    expect(await listBookableDivers(db, shop.id, trip.id, { query: "gary" })).toEqual([]);
  });
});

/**
 * Diver erasure (ADR 20260802-diver-data-erasure) — the destructive
 * counterpart to `deleteDiver`'s reversible removal, which the tests above
 * deliberately keep asserting unchanged.
 *
 * The failure mode this suite exists to catch is a **miss**: one table left
 * un-scrubbed, still holding a name, a number, or a medical answer. So every
 * table the sweep claims is asserted on its own, from a fixture that populates
 * all of them, rather than spot-checked through a read helper that might filter
 * the leak out of view.
 */
describe("diver erasure", () => {
  const BLOB = "https://abc123.public.blob.vercel-storage.com";
  const erasureNow = new Date("2026-07-18T12:00:00.000Z");

  async function personIdByName(db: AppDb, shopId: string, fullName: string) {
    const [row] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shopId), eq(people.fullName, fullName)));
    if (!row) throw new Error(`seed person missing: ${fullName}`);
    return row.id;
  }

  /** A diver with a row in every table the sweep touches. */
  async function erasableDiver() {
    const { db, shop } = await seededShopContext();
    const ownerId = await personIdByName(db, shop.id, "Dana Reyes");
    const captainId = await personIdByName(db, shop.id, "Sal Moretti");

    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Erasure Elena",
      email: "elena@example.com",
      phone: "+1 305 555 0142",
    });
    if (!diver) throw new Error("diver insert failed");
    await updateDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Erasure Elena",
      email: "elena@example.com",
      phone: "+1 305 555 0142",
      diveInsurance: "DAN #90210",
      dateOfBirth: "1990-04-01",
      emergencyContactName: "Robin Elena",
      emergencyContactPhone: "+1 305 555 0143",
    });
    await db.update(people).set({ locale: "es-ES" }).where(eq(people.id, diver.id));

    const [trip] = (await upcomingTripsWithCounts(db, shop.id)).filter(
      (t) => t.booked < t.capacity,
    );
    if (!trip) throw new Error("no open seeded trip");
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      personId: diver.id,
    });
    if (!booked.ok) throw new Error(`booking failed: ${booked.reason}`);
    const bookingId = booked.bookingId;
    await db
      .update(bookings)
      .set({ groupPreference: "likes to buddy with Marta" })
      .where(eq(bookings.id, bookingId));

    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId,
      now: erasureNow,
    });
    if (!issued.ok) throw new Error(`waiver issue failed: ${issued.reason}`);
    const completed = await completeWaiver(db, issued.token, {
      signerName: "Erasure Elena",
      agreed: true,
      medicalAnswers: {
        questionnaireId: "rstc",
        questionnaireVersion: 1,
        responses: { q1: false },
      },
      now: erasureNow,
    });
    if (!completed.ok) throw new Error("waiver completion failed");
    await db
      .update(waiverRecords)
      .set({
        importedFromLabel: "Old Shop CRM",
        importSourceDocumentUrl: `${BLOB}/waivers/elena-release.pdf`,
        importSourceMedicalDocumentUrl: `${BLOB}/waivers/elena-medical.pdf`,
      })
      .where(eq(waiverRecords.id, issued.recordId));
    // Re-seal so the fixture's own edits above leave a genuinely valid v1 record
    // — otherwise the "still verifies after erasure" assertion would be reading
    // a record that was already invalid before the sweep ran.
    const [beforeSeal] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    if (!beforeSeal) throw new Error("waiver record missing");
    await db
      .update(waiverRecords)
      .set({ integrityHash: computeWaiverIntegrityHash(beforeSeal), integrityVersion: 1 })
      .where(eq(waiverRecords.id, issued.recordId));

    await db.insert(certifications).values({
      shopId: shop.id,
      personId: diver.id,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-ELENA-1",
      cardImageUrl: `${BLOB}/cards/elena-ow.jpg`,
      reviewNote: "Checked against Elena's PADI portal record",
      importedFromLabel: "Old Shop CRM",
      status: "verified",
    });
    await db.insert(specialtyCertifications).values({
      shopId: shop.id,
      personId: diver.id,
      agency: "padi",
      specialty: "deep",
      identifier: "PADI-ELENA-1",
      cardImageUrl: `${BLOB}/cards/elena-deep.jpg`,
      reviewNote: "Elena brought the physical card",
      status: "verified",
    });
    await db.insert(nitroxCertifications).values({
      shopId: shop.id,
      personId: diver.id,
      agency: "padi",
      identifier: "PADI-ELENA-N1",
      reviewNote: "Elena's nitrox ticket sighted",
      status: "verified",
    });

    await saveRentalFit(db, {
      shopId: shop.id,
      personId: diver.id,
      rentsBcd: true,
      rentsRegulator: true,
      rentsWetsuit: true,
      rentsMaskFins: true,
      rentsWeights: true,
      rentsDiveComputer: false,
      rentsGopro: false,
      bcdSize: "M",
      wetsuitSize: "3 mm / M",
      bootSize: "9",
      finSize: "L",
      weightPreference: "12 lb",
      note: "Elena prefers a longer hose",
    });

    await db.insert(internalNotes).values({
      shopId: shop.id,
      personId: diver.id,
      bookingId,
      body: "Elena mentioned a shoulder injury at the counter",
      createdByPersonId: ownerId,
    });
    await db.insert(activityEvents).values([
      {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        actorPersonId: captainId,
        message: "Sal checked Erasure Elena in at the dock",
        occurredAt: erasureNow,
      },
      // A note attached to the *diver* rather than a booking writes an event
      // with a null booking_id (src/db/operations.ts) — the case a purely
      // booking-scoped sweep silently misses.
      {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: null,
        actorPersonId: ownerId,
        message: "Dana Reyes added a private note about Erasure Elena",
        occurredAt: erasureNow,
      },
    ]);
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId,
      recordedByPersonId: captainId,
      status: "boarded",
      note: "Elena boarded last, said she felt fine",
      occurredAt: erasureNow,
    });
    await db.insert(bookingPayments).values({
      shopId: shop.id,
      bookingId,
      status: "paid",
      amountCents: 13000,
      note: "Elena paid cash at the counter",
    });
    await db.insert(priorVisits).values({
      shopId: shop.id,
      personId: diver.id,
      visitedOn: "2024-06-01",
      title: "Elena — two-tank Molasses Reef",
      statusLabel: "Completed",
      amountLabel: "$180.00",
      sourceLabel: "Old Shop CRM",
      sourceReference: "ORD-ELENA-77",
      dedupeKey: "ORD-ELENA-77",
      importedAt: erasureNow,
    });
    await db.insert(tripReviews).values({
      shopId: shop.id,
      bookingId,
      tripId: trip.id,
      personId: diver.id,
      rating: 5,
      comment: "Elena here — Sal was wonderful, ask for him by name!",
      isPublished: true,
      publishedAt: erasureNow,
    });
    await db.insert(orders).values({
      shopId: shop.id,
      bookingId,
      personId: diver.id,
      createdByPersonId: ownerId,
      status: "paid",
      totalCents: 13000,
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_elena",
      stripeInvoiceId: "in_elena",
      hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_test/elena",
      invoicePdfUrl: "https://invoice.stripe.com/i/acct_test/elena.pdf",
    });
    await db.insert(recapPhotos).values({
      shopId: shop.id,
      bookingId,
      tripId: trip.id,
      imageUrl: `${BLOB}/recap/elena-1.jpg`,
      caption: "Elena and a turtle",
    });
    await db.insert(notificationDeliveries).values({
      shopId: shop.id,
      bookingId,
      kind: "waiver_request",
      status: "failed",
      providerDetail: "550 5.1.1 elena@example.com: recipient rejected",
      sendError: "bounce for elena@example.com",
      attemptedAt: erasureNow,
    });
    await db.insert(notificationSendQueue).values([
      {
        shopId: shop.id,
        idempotencyKey: "erasure-elena-by-address",
        payload: {
          kind: "trip_recap",
          bookingId: "00000000-0000-4000-8000-0000000000aa",
          shopId: shop.id,
          to: "Elena@example.com",
          locale: "en-US",
          diverName: "Erasure Elena",
        } as never,
        nextAttemptAt: erasureNow,
      },
      {
        shopId: shop.id,
        idempotencyKey: "erasure-elena-by-booking",
        payload: {
          kind: "waiver_request",
          bookingId,
          shopId: shop.id,
          to: "someone-else@example.com",
          diverName: "Erasure Elena",
        } as never,
        nextAttemptAt: erasureNow,
      },
    ]);
    await db.insert(calendarFeeds).values({
      shopId: shop.id,
      personId: diver.id,
      scope: "assignments",
      tokenHash: "elena-feed-hash",
    });
    await db.insert(bookingCapabilities).values({
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
      tokenHash: "elena-readiness-hash",
      expiresAt: new Date(erasureNow.getTime() + 86_400_000),
    });
    await db.insert(tripWaitlistEntries).values({
      shopId: shop.id,
      tripId: trip.id,
      personId: diver.id,
    });
    const [listEntry] = await db
      .insert(lastMinuteListEntries)
      .values({ shopId: shop.id, personId: diver.id })
      .returning();
    if (!listEntry) throw new Error("last-minute list insert failed");
    await db.insert(lastMinuteListUnsubscribeTokens).values({
      shopId: shop.id,
      entryId: listEntry.id,
      tokenHash: "elena-unsub-hash",
    });
    await db.insert(personCourtesyEmailUnsubscribeTokens).values({
      shopId: shop.id,
      personId: diver.id,
      tokenHash: "elena-courtesy-hash",
    });
    const [course] = await db.select().from(courses).where(eq(courses.shopId, shop.id)).limit(1);
    if (!course) throw new Error("seed course missing");
    await db.insert(courseInquiries).values({
      shopId: shop.id,
      courseId: course.id,
      name: "Erasure Elena",
      email: "ELENA@example.com",
      phone: "+1 305 555 0142",
      experienceLevel: "certified",
      timing: "any weekend in September",
      message: "Elena here — is the advanced course running?",
    });

    return { db, shop, diver, ownerId, captainId, bookingId, trip, waiverId: issued.recordId };
  }

  it("scrubs every table that holds the diver's identity or medical data", async () => {
    const { db, shop, diver, ownerId, bookingId, waiverId } = await erasableDiver();

    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: ownerId,
    });
    expect(result).toMatchObject({ ok: true, alreadyAnonymized: false });

    const [person] = await db.select().from(people).where(eq(people.id, diver.id));
    expect(person).toMatchObject({
      fullName: ANONYMIZED_PERSON_NAME,
      email: null,
      phone: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      dateOfBirth: null,
      diveInsurance: null,
      locale: null,
      courtesyEmailOptOutAt: null,
      anonymizedByPersonId: ownerId,
    });
    expect(person?.anonymizedAt).toBeInstanceOf(Date);
    // Erasure removes them from the active roster in the same breath — the
    // check constraint requires it, and a live person with no name is nonsense.
    expect(person?.deletedAt).toBeInstanceOf(Date);
    expect(
      await db.select().from(personRoles).where(eq(personRoles.personId, diver.id)),
    ).toHaveLength(0);

    const [waiver] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, waiverId));
    expect(waiver).toMatchObject({
      signedName: null,
      medicalAnswers: null,
      draftSignerName: null,
      draftMedicalAnswers: null,
      draftAcknowledged: false,
      importedFromLabel: null,
      importSourceDocumentUrl: null,
      importSourceMedicalDocumentUrl: null,
      startedAt: null,
    });

    const [levelCard] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, diver.id));
    expect(levelCard?.identifier).not.toContain("ELENA");
    expect(levelCard).toMatchObject({
      cardImageUrl: null,
      reviewNote: null,
      importedFromLabel: null,
      // The sighting survives: agency, level, and status are what the shop
      // checked, not who it belonged to.
      agency: "padi",
      level: "open_water",
      status: "verified",
    });
    expect(levelCard?.deletedAt).toBeInstanceOf(Date);

    const [specialtyCard] = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, diver.id));
    expect(specialtyCard?.identifier).not.toContain("ELENA");
    expect(specialtyCard).toMatchObject({ cardImageUrl: null, reviewNote: null });

    const [nitroxCard] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.personId, diver.id));
    expect(nitroxCard?.identifier).not.toContain("ELENA");
    expect(nitroxCard).toMatchObject({ reviewNote: null, importedFromLabel: null });

    expect(
      await db.select().from(rentalFitProfiles).where(eq(rentalFitProfiles.personId, diver.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(internalNotes).where(eq(internalNotes.personId, diver.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(tripWaitlistEntries).where(eq(tripWaitlistEntries.personId, diver.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(lastMinuteListEntries)
        .where(eq(lastMinuteListEntries.personId, diver.id)),
    ).toHaveLength(0);
    expect(await db.select().from(lastMinuteListUnsubscribeTokens)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(personCourtesyEmailUnsubscribeTokens)
        .where(eq(personCourtesyEmailUnsubscribeTokens.personId, diver.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(recapPhotos).where(eq(recapPhotos.bookingId, bookingId)),
    ).toHaveLength(0);

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking?.groupPreference).toBeNull();

    // Both the booking-scoped event and the diver-scoped one with a null
    // booking_id — the latter is only reachable by matching the stored name.
    const events = await db.select().from(activityEvents).where(eq(activityEvents.shopId, shop.id));
    expect(events.filter((row) => row.message === REDACTED_TEXT)).toHaveLength(2);
    expect(events.filter((row) => row.message.includes("Erasure Elena"))).toEqual([]);

    const [rollCall] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.bookingId, bookingId));
    expect(rollCall?.note).toBeNull();
    expect(rollCall?.status).toBe("boarded");

    const [payment] = await db
      .select()
      .from(bookingPayments)
      .where(eq(bookingPayments.bookingId, bookingId));
    expect(payment).toMatchObject({ note: null, status: "paid", amountCents: 13000 });

    const [visit] = await db.select().from(priorVisits).where(eq(priorVisits.personId, diver.id));
    expect(visit).toMatchObject({
      title: null,
      statusLabel: null,
      amountLabel: null,
      sourceLabel: null,
      sourceReference: null,
    });
    expect(visit?.dedupeKey).not.toContain("ELENA");
    expect(visit?.visitedOn).toBe("2024-06-01");

    const [review] = await db.select().from(tripReviews).where(eq(tripReviews.personId, diver.id));
    expect(review).toMatchObject({ comment: null, isPublished: false, publishedAt: null });

    const [order] = await db.select().from(orders).where(eq(orders.personId, diver.id));
    expect(order).toMatchObject({ hostedInvoiceUrl: null, invoicePdfUrl: null });
    // Documented residual: Stripe's own pointers are NOT NULL and cannot be
    // rewritten from here — see ADR 20260802-diver-data-erasure.
    expect(order?.stripeCustomerId).toBe("cus_elena");

    const [delivery] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, bookingId));
    expect(delivery).toMatchObject({ providerDetail: null, sendError: null });

    // The un-normalized PII blob: matched both by recipient address (case
    // insensitively) and by the booking it names.
    expect(
      await db
        .select()
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.shopId, shop.id)),
    ).toHaveLength(0);

    const [feed] = await db
      .select()
      .from(calendarFeeds)
      .where(eq(calendarFeeds.personId, diver.id));
    expect(feed?.revokedAt).toBeInstanceOf(Date);

    const [capability] = await db
      .select()
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, bookingId));
    expect(capability?.revokedAt).toBeInstanceOf(Date);

    // `course_inquiries` carries no person_id at all, so it is swept on the
    // contact details the diver themselves supplied — the only link there is.
    const inquiries = await db
      .select()
      .from(courseInquiries)
      .where(eq(courseInquiries.shopId, shop.id));
    expect(inquiries).not.toHaveLength(0);
    expect(
      inquiries.filter(
        (row) => row.email !== null || row.phone !== null || row.name !== null || row.message,
      ),
    ).toEqual([]);
  });

  it("erases a diver who has nothing but a name", async () => {
    const { db, shop } = await seededShopContext();
    const ownerId = await personIdByName(db, shop.id, "Dana Reyes");
    const diver = await createDiver(db, { shopId: shop.id, fullName: "Bare Bernard" });
    if (!diver) throw new Error("diver insert failed");

    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: ownerId }),
    ).toEqual({ ok: true, alreadyAnonymized: false, queuedMediaDeletions: 0 });
    const [person] = await db.select().from(people).where(eq(people.id, diver.id));
    expect(person).toMatchObject({ fullName: ANONYMIZED_PERSON_NAME, email: null });
    expect(person?.anonymizedAt).toBeInstanceOf(Date);
  });

  it("retires every blob it drops a URL for through the media-deletion ledger", async () => {
    const { db, shop, diver, ownerId } = await erasableDiver();
    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: ownerId,
    });
    if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

    const queued = await db
      .select()
      .from(mediaDeletionAttempts)
      .where(eq(mediaDeletionAttempts.shopId, shop.id));
    expect(queued.map((row) => row.url).sort()).toEqual(
      [
        `${BLOB}/cards/elena-deep.jpg`,
        `${BLOB}/cards/elena-ow.jpg`,
        `${BLOB}/recap/elena-1.jpg`,
        `${BLOB}/waivers/elena-medical.pdf`,
        `${BLOB}/waivers/elena-release.pdf`,
      ].sort(),
    );
    expect(new Set(queued.map((row) => row.kind))).toEqual(
      new Set(["certification_card", "recap_photo", "waiver_document"]),
    );
    expect(queued.every((row) => row.status === "pending")).toBe(true);
    expect(result.queuedMediaDeletions).toBe(queued.length);
  });

  it("keeps the signed evidence skeleton byte-for-byte and re-seals it as valid under v2", async () => {
    const { db, shop, diver, ownerId, waiverId } = await erasableDiver();
    const [before] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, waiverId));
    if (!before) throw new Error("waiver record missing");
    expect(verifyWaiverIntegrity(before)).toBe("valid");

    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: ownerId,
    });
    if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

    const [after] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, waiverId));
    if (!after) throw new Error("waiver record vanished");

    // The skeleton the ADR promises survives, unchanged.
    expect(after.id).toBe(before.id);
    expect(after.shopId).toBe(before.shopId);
    expect(after.bookingId).toBe(before.bookingId);
    expect(after.personId).toBe(before.personId);
    expect(after.templateId).toBe(before.templateId);
    expect(after.templateTitle).toBe(before.templateTitle);
    expect(after.templateVersion).toBe(before.templateVersion);
    expect(after.templateBody).toBe(before.templateBody);
    expect(after.status).toBe(before.status);
    expect(after.signatureMethod).toBe(before.signatureMethod);
    expect(after.recordedByPersonId).toBe(before.recordedByPersonId);
    expect(after.consentedAt?.getTime()).toBe(before.consentedAt?.getTime());
    expect(after.signedAt?.getTime()).toBe(before.signedAt?.getTime());
    expect(after.completedAt?.getTime()).toBe(before.completedAt?.getTime());
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());

    // And it verifies — as erased, not as tampered.
    expect(after.integrityVersion).toBe(2);
    expect(after.integrityHash).not.toBe(before.integrityHash);
    expect(verifyWaiverIntegrity(after)).toBe("valid");
    expect(after.anonymizedByPersonId).toBe(ownerId);
    expect(after.anonymizedAt).toBeInstanceOf(Date);

    // The link is dead: the hash no longer matches any issued token, and the
    // record has expired.
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("is idempotent — a replayed call changes nothing", async () => {
    const { db, shop, diver, ownerId, waiverId } = await erasableDiver();
    const first = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: ownerId,
    });
    if (!first.ok) throw new Error("first erasure refused");
    const [afterFirst] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, waiverId));
    const [personAfterFirst] = await db.select().from(people).where(eq(people.id, diver.id));

    const second = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: ownerId,
    });
    expect(second).toEqual({ ok: true, alreadyAnonymized: true, queuedMediaDeletions: 0 });

    const [afterSecond] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, waiverId));
    const [personAfterSecond] = await db.select().from(people).where(eq(people.id, diver.id));
    expect(afterSecond).toEqual(afterFirst);
    expect(personAfterSecond).toEqual(personAfterFirst);
    // No second round of blob deletions was queued.
    expect(
      await db
        .select()
        .from(mediaDeletionAttempts)
        .where(eq(mediaDeletionAttempts.shopId, shop.id)),
    ).toHaveLength(first.queuedMediaDeletions);
  });

  it("cannot be restored, by the caller or by the database", async () => {
    const { db, shop, diver, ownerId } = await erasableDiver();
    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: ownerId,
    });
    if (!result.ok) throw new Error("erasure refused");

    expect(await restoreDiver(db, shop.id, diver.id)).toBe(false);
    // Structural, not conventional: the roster's undo affordance calls
    // restoreDiver, but a future caller that skips it is refused anyway.
    await expect(
      db.update(people).set({ deletedAt: null }).where(eq(people.id, diver.id)),
    ).rejects.toThrow();
    const [person] = await db.select().from(people).where(eq(people.id, diver.id));
    expect(person?.deletedAt).toBeInstanceOf(Date);
  });

  it("refuses anyone who is not a live owner of this shop", async () => {
    const { db, shop, diver } = await erasableDiver();
    // A manager may remove a diver; only an owner may erase one.
    const managerOnly = await createDiver(db, { shopId: shop.id, fullName: "Manager Mo" });
    if (!managerOnly) throw new Error("staff insert failed");
    await db.insert(personRoles).values({ personId: managerOnly.id, role: "manager" });
    await db
      .insert(userAccounts)
      .values({ personId: managerOnly.id, email: "mo@example.com", hashedPassword: "x" });
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: managerOnly.id,
      }),
    ).toEqual({ ok: false, reason: "not_authorized" });

    // The captain is staff, but not an owner.
    const captainId = await personIdByName(db, shop.id, "Sal Moretti");
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: captainId }),
    ).toEqual({ ok: false, reason: "not_authorized" });

    const [untouched] = await db.select().from(people).where(eq(people.id, diver.id));
    expect(untouched?.fullName).toBe("Erasure Elena");
    expect(untouched?.anonymizedAt).toBeNull();
  });

  it("refuses to erase a staff member or the acting owner themselves", async () => {
    const { db, shop, ownerId, captainId } = await erasableDiver();
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: captainId, actorPersonId: ownerId }),
    ).toEqual({ ok: false, reason: "staff_member" });
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: ownerId, actorPersonId: ownerId }),
    ).toEqual({ ok: false, reason: "self" });
  });

  it("is tenant-scoped and cannot reach another shop's diver", async () => {
    const { db, shop, ownerId } = await erasableDiver();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-erasure", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const rivalDiver = await createDiver(db, { shopId: rival.id, fullName: "Rival Rae" });
    if (!rivalDiver) throw new Error("rival diver insert failed");

    // The owner's own shop id is what scopes the write — the person id alone
    // never is.
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: rivalDiver.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    // And naming the rival's shop does not lend the owner authority there.
    expect(
      await anonymizeDiver(db, {
        shopId: rival.id,
        personId: rivalDiver.id,
        actorPersonId: ownerId,
      }),
    ).toEqual({ ok: false, reason: "not_authorized" });

    const [rae] = await db.select().from(people).where(eq(people.id, rivalDiver.id));
    expect(rae?.fullName).toBe("Rival Rae");
    expect(rae?.anonymizedAt).toBeNull();
  });

  it("leaves the shop's other divers entirely alone", async () => {
    const { db, shop, diver, ownerId } = await erasableDiver();
    const bystander = await createDiver(db, {
      shopId: shop.id,
      fullName: "Bystander Bea",
      email: "bea@example.com",
      phone: "+1 305 555 0199",
    });
    if (!bystander) throw new Error("bystander insert failed");
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: bystander.id,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-BEA-1",
    });

    const result = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: ownerId,
    });
    if (!result.ok) throw new Error("erasure refused");

    const [bea] = await db.select().from(people).where(eq(people.id, bystander.id));
    expect(bea).toMatchObject({ fullName: "Bystander Bea", email: "bea@example.com" });
    const [beaCard] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, bystander.id));
    expect(beaCard).toMatchObject({ identifier: "PADI-BEA-1", deletedAt: null });
  });
});
