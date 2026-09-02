import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ANONYMIZED_PERSON_NAME, REDACTED_TEXT } from "@/lib/anonymization";
import { nowDate, nowMs } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import type { DeleteCustomerResult } from "@/lib/payments/customers";
import { computeWaiverIntegrityHash, verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import {
  createDiver,
  deleteDiver,
  findSimilarDivers,
  getDiverProfile,
  listBookableDivers,
  listDiverSummaries,
  restoreDiver,
  updateDiver,
} from "./divers";
import { listOwedProcessorErasures } from "./processor-erasure";
import { saveRentalFit } from "./rental-fit";
import {
  activityEvents,
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  buddyTeamEvents,
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
  notificationDeliveryAttempts,
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
  trips,
  tripWaitlistEntries,
  userAccounts,
  waiverRecords,
} from "./schema";
import { clearNoCertificationDeclaration, recordSelfDeclaredCards } from "./self-declared-cards";
import { upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

/**
 * File-scoped database (issue #1244): one PGlite for the whole file, and a
 * transaction per test that is rolled back afterwards. The roster is a read
 * surface — thirty tests that seat, search, page and filter, each reading back
 * what it just wrote — so nothing here needs its rows committed.
 */
const ctx = fileScopedShopContext();

describe("person-first diver records", () => {
  it("uses contact information as the temporary name for contact-first intake", async () => {
    const { db, shop } = ctx;
    const byEmail = await createDiver(db, {
      shopId: shop.id,
      email: "contact-first@example.com",
    });
    expect(byEmail?.fullName).toBe("contact-first@example.com");

    const byPhone = await createDiver(db, {
      shopId: shop.id,
      phone: "+1 305 555 0188",
    });
    expect(byPhone?.fullName).toBe("+1 305 555 0188");
  });

  it("resolves the staff member who cleared a self-declared no-certification stamp", async () => {
    const { db, shop } = ctx;
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Cleared Casey",
      email: "cleared-casey@example.com",
    });
    if (!diver) throw new Error("diver insert failed");
    const [staff] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
      .limit(1);
    if (!staff) throw new Error("seed staff missing");

    await recordSelfDeclaredCards(db, {
      shopId: shop.id,
      personId: diver.id,
      noCertification: true,
    });
    await clearNoCertificationDeclaration(db, {
      shopId: shop.id,
      personId: diver.id,
      byPersonId: staff.id,
    });

    expect((await getDiverProfile(db, shop.id, diver.id))?.noCertificationClearedByName).toBe(
      "Dana Reyes",
    );
  });

  it("composes cards, fit, and history from one diver record", async () => {
    const { db, shop } = ctx;

    // Search explicitly rather than relying on the default (alphabetically
    // sorted, page-sized) listing — the extended roster is well past one page.
    const { divers: summaries } = await listDiverSummaries(db, shop.id, { query: "Priya Sharma" });
    const priya = summaries.find((row) => row.fullName === "Priya Sharma");
    if (!priya) throw new Error("seed diver missing");
    // The roster row is the person and nothing more: the card counts and the
    // level it used to carry went with the columns the ledger retired, and the
    // three columns below are the ones it must never ship to a browser.
    expect(priya).toMatchObject({
      dateOfBirth: null,
      diveInsurance: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
    });

    const profile = await saveRentalFit(db, {
      shopId: shop.id,
      personId: priya.id,
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

    const detail = await getDiverProfile(db, shop.id, priya.id);
    expect(detail?.rentalFit).toMatchObject({ bcdSize: "M", finSize: "L", rentsRegulator: false });
    expect(detail?.certifications).toHaveLength(1);
  });

  it("can add a returning diver before a booking and rejects staff-only records", async () => {
    const { db, shop } = ctx;

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
      (row) => row.fullName === "Dana Reyes",
    );
    expect(staff).toBeUndefined();
  });

  // Task 144 (safety-adjacent — this prints on the manifest): staff can now
  // type an emergency contact straight onto the diver record, not just "ask
  // at the counter" with nowhere to record it.
  describe("updateDiver emergency contact fields", () => {
    it("writes both fields, leaves them untouched when omitted, and clears them on blank", async () => {
      const { db, shop } = ctx;
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
      const { db, shop } = ctx;
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
    const { db, shop } = ctx;
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Archived Alex",
      email: "alex@example.com",
    });
    if (!diver) throw new Error("diver insert failed");

    expect(await deleteDiver(db, shop.id, diver.id)).toBe(true);
    expect((await listDiverSummaries(db, shop.id)).divers.some((row) => row.id === diver.id)).toBe(
      false,
    );
    expect(await getDiverProfile(db, shop.id, diver.id)).toBeNull();
    expect(await restoreDiver(db, shop.id, diver.id)).toBe(true);
    expect((await listDiverSummaries(db, shop.id)).divers.some((row) => row.id === diver.id)).toBe(
      true,
    );
  });

  /**
   * Removal was always reversible in the data, and until this view existed it
   * was not reversible in the product: a removed diver matched no search, sat
   * in no roster view, and their record 404'd, so the only way back was the few
   * seconds the undo toast was on screen. These are the two reads that put a
   * removed diver back within a staffer's reach.
   */
  describe("finding a removed diver again", () => {
    /** The seeded shop owner — the only role allowed to erase (H-14). */
    async function ownerId(db: AppDb, shopId: string) {
      const [row] = await db
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.shopId, shopId), eq(people.fullName, "Dana Reyes")));
      if (!row) throw new Error("seed owner missing");
      return row.id;
    }

    async function removedDiver(db: AppDb, shopId: string) {
      const diver = await createDiver(db, {
        shopId,
        fullName: "Archived Alex",
        email: "alex@example.com",
      });
      if (!diver) throw new Error("diver insert failed");
      expect(await deleteDiver(db, shopId, diver.id)).toBe(true);
      return diver;
    }

    it("lists removed divers under their own view, and nowhere else", async () => {
      const { db, shop } = ctx;
      const diver = await removedDiver(db, shop.id);

      const removed = await listDiverSummaries(db, shop.id, { filter: "removed", limit: 1000 });
      expect(removed.divers.map((row) => row.id)).toContain(diver.id);
      // The removed view is *only* removed people — an active roster leaking
      // into it would read as "everyone is removed".
      expect(removed.divers.every((row) => row.deletedAt !== null)).toBe(true);

      // Every other view is untouched: this is a way to see a removal, not an
      // un-removal, and nothing operational may pick these people up.
      for (const filter of ["all", "diving_today", "needs_attention", "missing_contact"] as const) {
        const page = await listDiverSummaries(db, shop.id, { filter, limit: 1000 });
        expect(page.divers.some((row) => row.id === diver.id)).toBe(false);
      }
    });

    it("searches within the removed view, so a long list is still navigable", async () => {
      const { db, shop } = ctx;
      const diver = await removedDiver(db, shop.id);

      const byName = await listDiverSummaries(db, shop.id, {
        filter: "removed",
        query: "Archived",
      });
      expect(byName.divers.map((row) => row.id)).toEqual([diver.id]);
      expect(byName.total).toBe(1);
      // And the same search over the active roster still finds nobody.
      expect((await listDiverSummaries(db, shop.id, { query: "Archived" })).total).toBe(0);
    });

    it("keeps an erased record out of the removed view — there is no way back for one", async () => {
      const { db, shop } = ctx;
      const diver = await removedDiver(db, shop.id);
      const erased = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: await ownerId(db, shop.id),
      });
      expect(erased.ok).toBe(true);

      // `restoreDiver` refuses an erased record, so listing it under a view
      // whose only affordance is Restore would be a button that can never work.
      const removed = await listDiverSummaries(db, shop.id, { filter: "removed", limit: 1000 });
      expect(removed.divers.some((row) => row.id === diver.id)).toBe(false);
      expect(await restoreDiver(db, shop.id, diver.id)).toBe(false);
    });

    it("opens the removed diver's record on request, so the restore has somewhere to live", async () => {
      const { db, shop } = ctx;
      const diver = await removedDiver(db, shop.id);

      // The default is unchanged — every caller that drives shop work still
      // sees nothing.
      expect(await getDiverProfile(db, shop.id, diver.id)).toBeNull();

      const profile = await getDiverProfile(db, shop.id, diver.id, { includeRemoved: true });
      expect(profile?.person.id).toBe(diver.id);
      // The page needs to be able to tell which one it got.
      expect(profile?.person.deletedAt).toBeInstanceOf(Date);

      expect(await restoreDiver(db, shop.id, diver.id)).toBe(true);
      const restored = await getDiverProfile(db, shop.id, diver.id, { includeRemoved: true });
      expect(restored?.person.deletedAt).toBeNull();
    });

    it("still refuses an erased record even with removed records included", async () => {
      const { db, shop } = ctx;
      const diver = await removedDiver(db, shop.id);
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: await ownerId(db, shop.id),
      });
      expect(await getDiverProfile(db, shop.id, diver.id, { includeRemoved: true })).toBeNull();
    });

    it("does not open another shop's removed diver", async () => {
      const { db, shop } = ctx;
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Other Shop", slug: "other-shop-removed-diver-test", timezone: "UTC" })
        .returning();
      if (!otherShop) throw new Error("second shop insert failed");
      const diver = await removedDiver(db, shop.id);
      // A copied URL is the whole attack here: the record is reachable now, so
      // the tenant clause is what keeps it reachable only from its own shop.
      expect(
        await getDiverProfile(db, otherShop.id, diver.id, { includeRemoved: true }),
      ).toBeNull();
      expect(
        (await listDiverSummaries(db, otherShop.id, { filter: "removed", limit: 1000 })).divers,
      ).toEqual([]);
    });
  });

  it("frees a deleted diver's email for a genuinely new person, and refuses to restore into a collision (CR-008)", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;

    const byName = await listDiverSummaries(db, shop.id, { query: "priya" });
    expect(byName.divers.map((row) => row.fullName)).toEqual(["Priya Sharma"]);
    expect(byName.total).toBe(1);

    const byEmail = await listDiverSummaries(db, shop.id, { query: "priya.sharma@example" });
    expect(byEmail.divers).toHaveLength(1);

    const nobody = await listDiverSummaries(db, shop.id, { query: "zzz-no-such-diver" });
    expect(nobody.divers).toHaveLength(0);
    expect(nobody.total).toBe(0);
    // One empty page, not zero pages — the pager renders nothing at all here.
    expect(nobody.pageCount).toBe(1);
    expect(nobody.page).toBe(1);
  });

  it("filters the roster to whoever still owes a safety contact", async () => {
    const { db, shop } = ctx;
    const target = (await listDiverSummaries(db, shop.id)).divers[0];
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

    await db
      .update(people)
      .set({ emergencyContactName: "Kin Ono", emergencyContactPhone: "+1 305 555 0000" })
      .where(eq(people.id, target.id));

    // With a full contact now on file, the target leaves the "missing" view.
    const missing = await listDiverSummaries(db, shop.id, { filter: "missing_contact" });
    expect(missing.divers.some((row) => row.id === target.id)).toBe(false);
    expect(missing.total).toBe(baselineMissing - 1);
  });

  /**
   * "Needs attention" narrows the roster to the divers a staffer still owes a
   * look — a card awaiting review, or an imported card awaiting its one-tap
   * confirm (ADR 20260724-import-verified-cards). The row itself no longer
   * carries that count: the ledger's rows are a name, an exceptional badge and
   * one quiet fact (ADR 20260827-people-not-lists), and the chip is what says
   * why every row in this view is here. So the expectation is read straight
   * off the three card tables instead of off the row, which is the stronger
   * assertion anyway — it no longer proves the filter against a number the
   * same module computed.
   */
  it("filters the roster to whoever has a card waiting on a staffer", async () => {
    const { db, shop } = ctx;
    const roster = await listDiverSummaries(db, shop.id, { limit: 1000 });
    const rosterIds = new Set(roster.divers.map((row) => row.id));

    const waiting = new Set<string>();
    const collect = (
      rows: {
        personId: string;
        status: string;
        importedAt: Date | null;
        reviewedAt: Date | null;
        deletedAt: Date | null;
      }[],
    ) => {
      for (const row of rows) {
        if (row.deletedAt) continue;
        if (row.status === "pending" || (row.importedAt && !row.reviewedAt)) {
          if (rosterIds.has(row.personId)) waiting.add(row.personId);
        }
      }
    };
    collect(await db.select().from(certifications).where(eq(certifications.shopId, shop.id)));
    collect(
      await db
        .select()
        .from(specialtyCertifications)
        .where(eq(specialtyCertifications.shopId, shop.id)),
    );
    collect(
      await db.select().from(nitroxCertifications).where(eq(nitroxCertifications.shopId, shop.id)),
    );

    const flagged = await listDiverSummaries(db, shop.id, {
      filter: "needs_attention",
      limit: 1000,
    });
    const flaggedIds = new Set(flagged.divers.map((row) => row.id));
    expect(flagged.total).toBe(flagged.divers.length);
    expect(waiting.size).toBeGreaterThan(0);
    expect([...flaggedIds].sort()).toEqual([...waiting].sort());

    // Clearing the last waiting card takes that diver back out of the view.
    const targetId = [...waiting][0];
    if (!targetId) throw new Error("expected a diver with a waiting card");
    const reviewed = nowDate();
    for (const table of [certifications, specialtyCertifications, nitroxCertifications]) {
      await db
        .update(table)
        .set({ status: "verified", reviewedAt: reviewed })
        .where(eq(table.personId, targetId));
    }
    const after = await listDiverSummaries(db, shop.id, {
      filter: "needs_attention",
      limit: 1000,
    });
    expect(after.divers.some((row) => row.id === targetId)).toBe(false);
    expect(after.total).toBe(flagged.total - 1);
  });

  it("filters the roster to whoever holds a seat on one of today's boats", async () => {
    const { db, shop } = ctx;
    const target = (await listDiverSummaries(db, shop.id)).divers[0];
    if (!target) throw new Error("expected seeded divers");

    // A departure at midday in the shop's own timezone, so the assertion is
    // about the shop's calendar day rather than the server's.
    const now = new Date("2026-08-03T16:00:00Z");
    const [trip] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Diving-today probe",
        startsAt: new Date("2026-08-03T14:00:00Z"),
        endsAt: new Date("2026-08-03T18:00:00Z"),
        capacity: 6,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");

    const before = await listDiverSummaries(db, shop.id, {
      filter: "diving_today",
      timeZone: shop.timezone,
      now,
      limit: 1000,
    });
    expect(before.divers.some((row) => row.id === target.id)).toBe(false);

    const booking = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      personId: target.id,
    });
    expect(booking.ok).toBe(true);

    const booked = await listDiverSummaries(db, shop.id, {
      filter: "diving_today",
      timeZone: shop.timezone,
      now,
      limit: 1000,
    });
    expect(booked.divers.some((row) => row.id === target.id)).toBe(true);
    expect(booked.total).toBe(booked.divers.length);

    // Tomorrow the same seat is not today's work.
    const tomorrow = await listDiverSummaries(db, shop.id, {
      filter: "diving_today",
      timeZone: shop.timezone,
      now: new Date("2026-08-04T16:00:00Z"),
      limit: 1000,
    });
    expect(tomorrow.divers.some((row) => row.id === target.id)).toBe(false);

    // Nor is a cancelled departure a dive.
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    const cancelled = await listDiverSummaries(db, shop.id, {
      filter: "diving_today",
      timeZone: shop.timezone,
      now,
      limit: 1000,
    });
    expect(cancelled.divers.some((row) => row.id === target.id)).toBe(false);
  });

  it("pages by number and never repeats or skips a diver", async () => {
    const { db, shop } = ctx;

    // The extended roster is well past DIVER_PAGE_SIZE, so fetch a limit large
    // enough to get every diver back in one page as ground truth.
    const all = await listDiverSummaries(db, shop.id, { limit: 1000 });
    expect(all.pageCount).toBe(1);
    expect(all.total).toBe(all.divers.length);

    const seen: string[] = [];
    const first = await listDiverSummaries(db, shop.id, { limit: 3 });
    expect(first.pageCount).toBe(Math.ceil(all.total / 3));
    for (let page = 1; page <= first.pageCount; page++) {
      const chunk = await listDiverSummaries(db, shop.id, { page, limit: 3 });
      expect(chunk.page).toBe(page);
      expect(chunk.divers.length).toBeLessThanOrEqual(3);
      seen.push(...chunk.divers.map((row) => row.id));
    }
    expect(seen).toEqual(all.divers.map((row) => row.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("goes back a page as well as forward — the whole point of dropping the cursor", async () => {
    const { db, shop } = ctx;
    const second = await listDiverSummaries(db, shop.id, { page: 2, limit: 3 });
    const backAgain = await listDiverSummaries(db, shop.id, { page: second.page - 1, limit: 3 });
    const first = await listDiverSummaries(db, shop.id, { page: 1, limit: 3 });
    expect(backAgain.divers.map((row) => row.id)).toEqual(first.divers.map((row) => row.id));
  });

  it("treats a nonsensical page as the first page and one past the end as the last", async () => {
    const { db, shop } = ctx;
    const first = await listDiverSummaries(db, shop.id, { page: 1, limit: 3 });
    for (const requested of [0, -3, Number.NaN]) {
      const clamped = await listDiverSummaries(db, shop.id, { page: requested, limit: 3 });
      expect(clamped.page).toBe(1);
      expect(clamped.divers.map((row) => row.id)).toEqual(first.divers.map((row) => row.id));
    }

    // A bookmarked page from a longer roster lands on the last real page with
    // rows on it, never an empty table under an impossible "Page 999 of 8".
    const last = await listDiverSummaries(db, shop.id, { page: 999, limit: 3 });
    expect(last.page).toBe(last.pageCount);
    expect(last.divers.length).toBeGreaterThan(0);
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
    const { db, shop } = ctx;
    const trip = await openTrip(db, shop.id);
    expect(await listBookableDivers(db, shop.id, trip.id, { query: "  " })).toEqual([]);
  });

  it("finds a returning diver and carries their rental fit", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
  const BLOB = "https://diveday-media.s3.us-east-1.amazonaws.com";
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
  async function erasableDiver(override?: { db: AppDb; shop: typeof ctx.shop }) {
    const { db, shop } = override ?? ctx;
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
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
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
      reviewNote: "Elena shared her digital certification record",
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
      occurredAt: erasureNow,
    });
    await db.insert(bookingPayments).values({
      shopId: shop.id,
      currency: "usd",
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
    // The connected account the orders below were created on. A real order can
    // only exist on one, and the processor erasure re-proves the account still
    // belongs to this shop before it fires a delete at it — so a fixture that
    // skipped this would be testing a shop whose orders name somebody else's
    // Stripe account.
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    await db.insert(orders).values({
      shopId: shop.id,
      currency: "usd",
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
    // The append-only twin, written from the same `delivery.detail` in the
    // same call (`sendNotification`, src/db/notifications.ts) — so it quotes
    // the same address the row above does.
    await db.insert(notificationDeliveryAttempts).values({
      shopId: shop.id,
      bookingId,
      kind: "waiver_request",
      status: "failed",
      sendErrorCode: "bounced",
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
    // Held by id, not by any of its own text: the sweep blanks every free-text
    // column on this row, so after erasure there is nothing left on it to
    // recognise it by.
    const [elenaInquiry] = await db
      .insert(courseInquiries)
      .values({
        shopId: shop.id,
        courseId: course.id,
        name: "Erasure Elena",
        email: "ELENA@example.com",
        phone: "+1 305 555 0142",
        experienceLevel: "certified",
        timing: "any weekend in September",
        message: "Elena here — is the advanced course running?",
      })
      .returning({ id: courseInquiries.id });
    if (!elenaInquiry) throw new Error("course inquiry insert returned no row");

    return {
      db,
      shop,
      diver,
      ownerId,
      captainId,
      bookingId,
      trip,
      waiverId: issued.recordId,
      elenaInquiryId: elenaInquiry.id,
    };
  }

  it("scrubs every table that holds the diver's identity or medical data", async () => {
    const { db, shop, diver, ownerId, bookingId, waiverId, elenaInquiryId } = await erasableDiver();

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
    expect(specialtyCard).toMatchObject({ reviewNote: null });

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

    // The history behind that latest state carries the same quoted address and
    // is scrubbed with it; the provider's status *code* is not prose and stays.
    const [attempt] = await db
      .select()
      .from(notificationDeliveryAttempts)
      .where(eq(notificationDeliveryAttempts.bookingId, bookingId));
    expect(attempt).toMatchObject({ sendError: null, sendErrorCode: "bounced" });

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

    // `course_inquiries` is swept three ways: on `person_id` where the lead was
    // linked to a live diver at capture time, and otherwise on the email and
    // phone the diver themselves supplied, which are the only handles a lead
    // carries. Elena's lead has no `person_id` — it was written straight into
    // the table by this fixture, not through the capture path — so it is the
    // email/phone sweep that has to reach it.
    const inquiries = await db
      .select()
      .from(courseInquiries)
      .where(eq(courseInquiries.shopId, shop.id));
    expect(inquiries).not.toHaveLength(0);
    const elena = inquiries.find((row) => row.id === elenaInquiryId);
    expect(elena).toBeDefined();
    expect(elena).toMatchObject({ name: null, email: null, phone: null, message: null });

    // And the half that matters at least as much: erasing one diver must not
    // blank a bystander's lead. The seed carries three
    // (src/db/seed-course-inquiries.ts), none of them Elena's — they must come
    // through untouched. This assertion could not exist while the table was
    // empty on a seeded shop, so the sweep's *scoping* was never tested at all;
    // only its reach was.
    const bystanders = inquiries.filter((row) => row.id !== elenaInquiryId);
    expect(bystanders.length).toBeGreaterThan(0);
    expect(bystanders.some((row) => row.name !== null)).toBe(true);
    expect(bystanders.some((row) => row.message !== null)).toBe(true);
    expect(bystanders.some((row) => row.phone !== null)).toBe(true);
  });

  it("erases a diver who has nothing but a name", async () => {
    const { db, shop } = ctx;
    const ownerId = await personIdByName(db, shop.id, "Dana Reyes");
    const diver = await createDiver(db, { shopId: shop.id, fullName: "Bare Bernard" });
    if (!diver) throw new Error("diver insert failed");

    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: ownerId }),
    ).toEqual({
      ok: true,
      alreadyAnonymized: false,
      queuedMediaDeletions: 0,
      dischargedProcessorErasures: 0,
      owedProcessorErasures: 0,
    });
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
        `${BLOB}/recap/elena-1.jpg`,
        `${BLOB}/waivers/elena-medical.pdf`,
        `${BLOB}/waivers/elena-release.pdf`,
      ].sort(),
    );
    // No `certification_card`: a card has carried no photograph since ADR
    // 20260811-retire-the-digital-card dropped the column, so erasure has
    // nothing of that kind left to queue.
    expect(new Set(queued.map((row) => row.kind))).toEqual(
      new Set(["recap_photo", "waiver_document"]),
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
    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(nowMs());
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
    expect(second).toEqual({
      ok: true,
      alreadyAnonymized: true,
      queuedMediaDeletions: 0,
      dischargedProcessorErasures: 0,
      owedProcessorErasures: 0,
    });

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

  /**
   * The one test in this file that needs a **committed** database rather than
   * the file-scoped transaction, and for a reason worth naming: it provokes a
   * database error on purpose (`.rejects.toThrow()` on the restore) and then
   * keeps querying. Postgres aborts the *whole* transaction on a failed
   * statement — `current transaction is aborted, commands ignored until end of
   * transaction block` (25P02) — so inside a transaction every line after the
   * expected rejection fails too. In autocommit only the failing statement
   * fails, which is what this assertion is written against.
   */
  it("cannot be restored, by the caller or by the database", async () => {
    const own = await seededShopContext();
    const { db, shop, diver, ownerId } = await erasableDiver(own);
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

  /**
   * `booking_checkouts.customer_email` is un-normalized PII with no person_id,
   * and erasure cancels no booking and settles no payment — so a checkout left
   * holding the address stays a live candidate for `sendDueCheckoutRecoveries`
   * and the next cron tick mails the address the shop said it destroyed
   * (asserted end to end in src/db/checkout-recovery.test.ts).
   *
   * The column holds the *submitter's* address, so the party case has two
   * directions and both are pinned here.
   */
  describe("the checkout's copy of the address", () => {
    async function insertCheckout(
      db: AppDb,
      input: {
        shopId: string;
        tripId: string;
        sessionId: string;
        customerEmail: string;
        bookingIds: string[];
      },
    ) {
      const [row] = await db
        .insert(bookingCheckouts)
        .values({
          shopId: input.shopId,
          currency: "usd",
          tripId: input.tripId,
          stripeAccountId: "acct_test",
          stripeSessionId: input.sessionId,
          checkoutUrl: `https://checkout.stripe.com/c/pay/${input.sessionId}`,
          customerEmail: input.customerEmail,
          amountPerDiverCents: 18_000,
          totalCents: 18_000 * Math.max(input.bookingIds.length, 1),
        })
        .returning();
      if (!row) throw new Error("checkout insert failed");
      if (input.bookingIds.length > 0) {
        await db.insert(bookingCheckoutBookings).values(
          input.bookingIds.map((bookingId) => ({
            shopId: input.shopId,
            checkoutId: row.id,
            bookingId,
          })),
        );
      }
      return row;
    }

    /** Elena, plus a second diver holding their own seat on the same trip. */
    async function withCompanion() {
      const context = await erasableDiver();
      const companion = await createDiver(context.db, {
        shopId: context.shop.id,
        fullName: "Companion Cass",
        email: "cass@example.com",
      });
      if (!companion) throw new Error("companion insert failed");
      const booked = await createBooking(context.db, {
        actor: "staff",
        shopId: context.shop.id,
        tripId: context.trip.id,
        personId: companion.id,
      });
      if (!booked.ok) throw new Error(`companion booking failed: ${booked.reason}`);
      return { ...context, companion, companionBookingId: booked.bookingId };
    }

    async function emailOn(db: AppDb, checkoutId: string) {
      const [row] = await db
        .select()
        .from(bookingCheckouts)
        .where(eq(bookingCheckouts.id, checkoutId));
      return row?.customerEmail ?? null;
    }

    it("wipes the erased diver's own address, including off a party they hold no seat on", async () => {
      const { db, shop, diver, ownerId, trip, bookingId, companionBookingId } =
        await withCompanion();

      const solo = await insertCheckout(db, {
        shopId: shop.id,
        tripId: trip.id,
        sessionId: "cs_elena_solo",
        customerEmail: "elena@example.com",
        bookingIds: [bookingId],
      });
      // Elena paid for a friend and took no seat herself: no booking of hers is
      // on this checkout at all, so a booking-join sweep cannot see it — the
      // address on it is still hers.
      const paidForAFriend = await insertCheckout(db, {
        shopId: shop.id,
        tripId: trip.id,
        sessionId: "cs_elena_for_cass",
        // Stored case-insensitively, as `startBookingCheckout` received it.
        customerEmail: "ELENA@example.com",
        bookingIds: [companionBookingId],
      });

      const result = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: ownerId,
      });
      if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

      expect(await emailOn(db, solo.id)).toBeNull();
      expect(await emailOn(db, paidForAFriend.id)).toBeNull();
    });

    it("wipes an address that is no longer on the person row when the checkout is theirs alone", async () => {
      const { db, shop, diver, ownerId, trip, bookingId } = await erasableDiver();
      // Elena checked out under an older address and changed it afterwards, so
      // the address sweep cannot match it. The checkout covers nothing but her
      // own seat, so nobody else's address can be the one sitting here and
      // nobody else's payment link is lost with it.
      const stale = await insertCheckout(db, {
        shopId: shop.id,
        tripId: trip.id,
        sessionId: "cs_elena_stale",
        customerEmail: "elena-old-address@example.com",
        bookingIds: [bookingId],
      });

      const result = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: ownerId,
      });
      if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

      expect(await emailOn(db, stale.id)).toBeNull();
    });

    it("leaves a party lead's own address on a checkout covering divers who were not erased", async () => {
      const { db, shop, diver, ownerId, trip, bookingId, companionBookingId } =
        await withCompanion();
      // Cass led this party and Elena was one of the seats on it. The address
      // is Cass's — a live third party who never asked to be forgotten — and
      // blanking it would destroy her contact detail and take the rest of the
      // party's payment link with it.
      const ledByCompanion = await insertCheckout(db, {
        shopId: shop.id,
        tripId: trip.id,
        sessionId: "cs_cass_party",
        customerEmail: "cass@example.com",
        bookingIds: [bookingId, companionBookingId],
      });

      const result = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: ownerId,
      });
      if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

      expect(await emailOn(db, ledByCompanion.id)).toBe("cass@example.com");
    });

    it("wipes the erased diver's address off a party they led, even one covering others", async () => {
      const { db, shop, diver, ownerId, trip, bookingId, companionBookingId } =
        await withCompanion();
      // The mirror of the case above: the address is Elena's, so it goes even
      // though Cass loses the hosted link — the shop can quote her a fresh one.
      const ledByElena = await insertCheckout(db, {
        shopId: shop.id,
        tripId: trip.id,
        sessionId: "cs_elena_party",
        customerEmail: "elena@example.com",
        bookingIds: [bookingId, companionBookingId],
      });

      const result = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: ownerId,
      });
      if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

      expect(await emailOn(db, ledByElena.id)).toBeNull();
    });
  });

  /**
   * The name sweep matches against every message in the shop, so its bound is
   * the whole safety property. A substring match built from a two-character
   * name (`personSchema.fullName` allows one) reaches inside `Dana`,
   * `manifest` and `changed` — and this runs inside the erasure transaction,
   * with no way back.
   */
  describe("the buddy-team trail", () => {
    /**
     * `buddy_team_events.member_names` is denormalised so it outlives the
     * membership rows a dissolve deletes, and the table is never pruned. Both
     * are deliberate, and together they made it the one place an erased diver's
     * name would stand indefinitely — still printing on the incident export's
     * timeline. Found by a security review after the trail shipped.
     */
    async function shopWithTrail(fullName: string, memberNames: string[]) {
      const { db, shop } = ctx;
      const ownerId = await personIdByName(db, shop.id, "Dana Reyes");
      const captainId = await personIdByName(db, shop.id, "Sal Moretti");
      const diver = await createDiver(db, { shopId: shop.id, fullName });
      if (!diver) throw new Error("diver insert failed");
      const [trip] = await db.select().from(trips).where(eq(trips.shopId, shop.id)).limit(1);
      if (!trip) throw new Error("no trip");
      // Scoped to this team's own `pair_id`: the demo seed writes `formed`
      // entries of its own, and the sweep is shop-wide by design.
      const pairId = crypto.randomUUID();
      await db.insert(buddyTeamEvents).values({
        shopId: shop.id,
        tripId: trip.id,
        pairId,
        action: "formed",
        memberNames,
        recordedByPersonId: captainId,
        occurredAt: erasureNow,
      });
      return { db, shop, diver, ownerId, pairId };
    }

    async function trailNamesFor(db: AppDb, pairId: string) {
      const rows = await db
        .select({ memberNames: buddyTeamEvents.memberNames })
        .from(buddyTeamEvents)
        .where(eq(buddyTeamEvents.pairId, pairId));
      return rows.map((row) => row.memberNames);
    }

    it("redacts the erased diver's name and keeps the team's size", async () => {
      const { db, shop, diver, ownerId, pairId } = await shopWithTrail("Marina Kessler", [
        "Marina Kessler",
        "Tom Okafor",
        "Lena Fischer",
      ]);
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: ownerId,
      });
      // The element is replaced, never dropped: how many people were on a team
      // is a fact about the departure, not about the person who left it.
      expect(await trailNamesFor(db, pairId)).toEqual([
        [REDACTED_TEXT, "Tom Okafor", "Lena Fischer"],
      ]);
    });

    it("leaves a trail that never named them untouched", async () => {
      const { db, shop, diver, ownerId, pairId } = await shopWithTrail("Marina Kessler", [
        "Tom Okafor",
        "Lena Fischer",
      ]);
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: ownerId,
      });
      expect(await trailNamesFor(db, pairId)).toEqual([["Tom Okafor", "Lena Fischer"]]);
    });
  });

  describe("the activity-log name match", () => {
    async function shopWithHistory(fullName: string, messages: string[]) {
      const { db, shop } = ctx;
      const ownerId = await personIdByName(db, shop.id, "Dana Reyes");
      const captainId = await personIdByName(db, shop.id, "Sal Moretti");
      const diver = await createDiver(db, { shopId: shop.id, fullName });
      if (!diver) throw new Error("diver insert failed");
      await db.insert(activityEvents).values(
        messages.map((message) => ({
          shopId: shop.id,
          bookingId: null,
          // Attributed to staff, never to the erased diver — the actor sweep is
          // exact and would redact these for reasons that have nothing to do
          // with the name match under test.
          actorPersonId: captainId,
          message,
          occurredAt: erasureNow,
        })),
      );
      return { db, shop, diver, ownerId };
    }

    async function messagesIn(db: AppDb, shopId: string) {
      const rows = await db
        .select({ message: activityEvents.message })
        .from(activityEvents)
        .where(eq(activityEvents.shopId, shopId));
      return rows.map((row) => row.message);
    }

    it("does not let a two-character name redact the shop's unrelated history", async () => {
      const history = [
        "Dana Reyes moved the manifest for the Alligator Reef charter",
        "Sal Moretti changed the roll call and credited a deposit",
        "Priya Sharma boarded early",
      ];
      const { db, shop, diver, ownerId } = await shopWithHistory("Al", history);

      const result = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: ownerId,
      });
      if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

      // Every one of these contains `al` as a substring. Not one is touched.
      const after = await messagesIn(db, shop.id);
      for (const message of history) expect(after).toContain(message);
      expect(after).not.toContain(REDACTED_TEXT);
    });

    it("matches a name at whole-word boundaries only", async () => {
      const { db, shop, diver, ownerId } = await shopWithHistory("Ana", [
        "Dana Reyes updated the manifest",
        "Sal Moretti added a private note about Ana",
      ]);

      const result = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: ownerId,
      });
      if (!result.ok) throw new Error(`erasure refused: ${result.reason}`);

      const after = await messagesIn(db, shop.id);
      // The diver-scoped note (null booking_id, no person link) is reached…
      expect(after).toContain(REDACTED_TEXT);
      expect(after.some((message) => message.includes("about Ana"))).toBe(false);
      // …and `Dana` is not `Ana`.
      expect(after).toContain("Dana Reyes updated the manifest");
    });
  });

  /**
   * `orders.stripe_customer_id` and `stripe_invoice_id` are NOT NULL pointers
   * into the shop's own Stripe account. The customer object is *deleted* — it
   * holds no charge, invoice or dispute, so the shop's financial trail survives
   * it — and the name/email Stripe snapshots onto a finalized invoice is
   * recorded as owed, because no API reaches it
   * (ADR 20260803-processor-erasure-obligations).
   */
  describe("the diver's records at Stripe", () => {
    /** A provider that answers the same way every time and counts its calls. */
    function providerReturning(result: DeleteCustomerResult) {
      return { deleteCustomer: vi.fn().mockResolvedValue(result) };
    }

    it("deletes the Stripe customer and records the invoice snapshot as still owed", async () => {
      const { db, shop, diver, ownerId } = await erasableDiver();
      const provider = providerReturning({ status: "deleted" });

      const result = await anonymizeDiver(
        db,
        { shopId: shop.id, personId: diver.id, actorPersonId: ownerId },
        { customerProvider: provider },
      );
      expect(result).toMatchObject({
        ok: true,
        dischargedProcessorErasures: 1,
        owedProcessorErasures: 1,
      });
      // Aimed at the account the order itself was created on.
      expect(provider.deleteCustomer).toHaveBeenCalledTimes(1);
      expect(provider.deleteCustomer).toHaveBeenCalledWith(
        "acct_test",
        "cus_elena",
        expect.stringContaining(":customer-delete"),
      );

      // What remains is the one thing no call can clear.
      const owed = await listOwedProcessorErasures(db, shop.id);
      expect(owed).toHaveLength(1);
      expect(owed[0]).toMatchObject({
        shopId: shop.id,
        personId: diver.id,
        target: "stripe_invoice_snapshot",
        externalId: "in_elena",
        status: "owed",
        attempts: 0,
      });
      // The row is a pointer, not a person — the identity is exactly what the
      // erasure just removed.
      expect(JSON.stringify(owed[0])).not.toContain("Elena");
    });

    it("attempts the delete once per distinct customer id", async () => {
      const { db, shop, diver, ownerId } = await erasableDiver();
      // A second order for the same diver on the same Stripe customer, plus a
      // third on a different one — one delete each, not one per order.
      await db.insert(orders).values([
        {
          currency: "usd",
          shopId: shop.id,
          personId: diver.id,
          createdByPersonId: ownerId,
          status: "paid",
          totalCents: 1000,
          stripeAccountId: "acct_test",
          stripeCustomerId: "cus_elena",
          stripeInvoiceId: "in_elena_2",
        },
        {
          currency: "usd",
          shopId: shop.id,
          personId: diver.id,
          createdByPersonId: ownerId,
          status: "paid",
          totalCents: 2000,
          stripeAccountId: "acct_test",
          stripeCustomerId: "cus_elena_legacy",
          stripeInvoiceId: "in_elena_3",
        },
      ]);
      const provider = providerReturning({ status: "deleted" });

      await anonymizeDiver(
        db,
        { shopId: shop.id, personId: diver.id, actorPersonId: ownerId },
        { customerProvider: provider },
      );

      expect(provider.deleteCustomer.mock.calls.map((call) => call[1]).sort()).toEqual([
        "cus_elena",
        "cus_elena_legacy",
      ]);
    });

    it("does not roll back the local erasure when Stripe fails, and leaves it owed", async () => {
      const { db, shop, diver, ownerId } = await erasableDiver();
      const provider = providerReturning({ status: "failed", error: "HTTP 503" });

      const result = await anonymizeDiver(
        db,
        { shopId: shop.id, personId: diver.id, actorPersonId: ownerId },
        { customerProvider: provider },
      );
      expect(result).toMatchObject({
        ok: true,
        dischargedProcessorErasures: 0,
        owedProcessorErasures: 2,
      });

      // The erasure the diver asked for stands, whatever Stripe did.
      const [person] = await db.select().from(people).where(eq(people.id, diver.id));
      expect(person).toMatchObject({ fullName: ANONYMIZED_PERSON_NAME, email: null });
      expect(person?.anonymizedAt).toBeInstanceOf(Date);

      // And the unfinished work is visible, with the reason on the row.
      const owed = await listOwedProcessorErasures(db, shop.id);
      const customerRow = owed.find((row) => row.target === "stripe_customer");
      expect(customerRow).toMatchObject({ attempts: 1, lastError: "HTTP 503" });
    });

    it("attempts nothing for a diver who never had an order", async () => {
      const { db, shop, ownerId } = await erasableDiver();
      const orderless = await createDiver(db, { shopId: shop.id, fullName: "Orderless Ola" });
      if (!orderless) throw new Error("diver insert failed");
      const provider = providerReturning({ status: "deleted" });

      const result = await anonymizeDiver(
        db,
        { shopId: shop.id, personId: orderless.id, actorPersonId: ownerId },
        { customerProvider: provider },
      );
      expect(result).toMatchObject({
        ok: true,
        dischargedProcessorErasures: 0,
        owedProcessorErasures: 0,
      });
      expect(provider.deleteCustomer).not.toHaveBeenCalled();
      expect(await listOwedProcessorErasures(db, shop.id)).toEqual([]);
    });

    it("never deletes a bystander's Stripe customer", async () => {
      const { db, shop, diver, ownerId, trip } = await erasableDiver();
      const bystander = await createDiver(db, {
        shopId: shop.id,
        fullName: "Bystander Bea",
        email: "bea@example.com",
      });
      if (!bystander) throw new Error("bystander insert failed");
      const beaBooking = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        personId: bystander.id,
      });
      if (!beaBooking.ok) throw new Error("bystander booking failed");
      await db.insert(orders).values({
        shopId: shop.id,
        currency: "usd",
        bookingId: beaBooking.bookingId,
        personId: bystander.id,
        createdByPersonId: ownerId,
        status: "paid",
        totalCents: 9000,
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_bea",
        stripeInvoiceId: "in_bea",
      });
      const provider = providerReturning({ status: "deleted" });

      await anonymizeDiver(
        db,
        { shopId: shop.id, personId: diver.id, actorPersonId: ownerId },
        { customerProvider: provider },
      );

      // Erasing one diver must never reach into another's records at the
      // processor — this is the irreversible one, so it is pinned hardest.
      expect(provider.deleteCustomer.mock.calls.map((call) => call[1])).toEqual(["cus_elena"]);
      const [beaOrder] = await db.select().from(orders).where(eq(orders.personId, bystander.id));
      expect(beaOrder?.stripeCustomerId).toBe("cus_bea");
    });

    it("does not raise an obligation visible to another shop", async () => {
      const { db, shop, diver, ownerId } = await erasableDiver();
      const [rival] = await db
        .insert(shops)
        .values({ name: "Rival Reef", slug: "rival-reef-processor-erasure", timezone: "UTC" })
        .returning();
      if (!rival) throw new Error("rival shop insert failed");

      await anonymizeDiver(
        db,
        { shopId: shop.id, personId: diver.id, actorPersonId: ownerId },
        { customerProvider: providerReturning({ status: "failed", error: "HTTP 503" }) },
      );

      expect(await listOwedProcessorErasures(db, shop.id)).toHaveLength(2);
      expect(await listOwedProcessorErasures(db, rival.id)).toEqual([]);
    });
  });

  /**
   * `course_inquiries` is written from a public page, before any person need
   * exist, so it carries a *nullable* `person_id` snapshotted at capture when
   * the supplied address already matched a live diver. That link is the only
   * handle the sweep has once the diver changes their email.
   */
  describe("the course lead's person link", () => {
    async function inquiryFor(
      db: AppDb,
      input: { shopId: string; personId?: string; email?: string; phone?: string; name: string },
    ) {
      const [course] = await db
        .select()
        .from(courses)
        .where(eq(courses.shopId, input.shopId))
        .limit(1);
      if (!course) throw new Error("seed course missing");
      const [row] = await db
        .insert(courseInquiries)
        .values({
          shopId: input.shopId,
          courseId: course.id,
          personId: input.personId ?? null,
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          experienceLevel: "certified",
          message: `${input.name} asking about the advanced course`,
        })
        .returning();
      if (!row) throw new Error("inquiry insert failed");
      return row.id;
    }

    async function inquiryById(db: AppDb, id: string) {
      const [row] = await db.select().from(courseInquiries).where(eq(courseInquiries.id, id));
      return row;
    }

    it("reaches a lead whose contact details no longer match the diver's", async () => {
      const { db, shop, diver, ownerId } = await erasableDiver();
      // The link was snapshotted when the addresses agreed; the diver has since
      // moved to a new address and dropped the number. Neither fuzzy handle can
      // find this row any more.
      const linked = await inquiryFor(db, {
        shopId: shop.id,
        personId: diver.id,
        name: "Erasure Elena",
        email: "elena-old@example.com",
      });

      const result = await anonymizeDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: ownerId,
      });
      if (!result.ok) throw new Error("erasure refused");

      expect(await inquiryById(db, linked)).toMatchObject({
        name: null,
        email: null,
        phone: null,
        message: null,
        // Kept: it points at an already-erased row, so it discloses nothing, and
        // it is what makes a replayed erasure reach this lead again.
        personId: diver.id,
      });
    });

    it("leaves a bystander's lead standing, linked or not", async () => {
      const { db, shop, diver, ownerId } = await erasableDiver();
      const bystander = await createDiver(db, {
        shopId: shop.id,
        fullName: "Bystander Bea",
        email: "bea@example.com",
      });
      if (!bystander) throw new Error("bystander insert failed");
      const beasOwn = await inquiryFor(db, {
        shopId: shop.id,
        personId: bystander.id,
        name: "Bystander Bea",
        email: "bea@example.com",
      });
      const unlinked = await inquiryFor(db, {
        shopId: shop.id,
        name: "Walk-in Wally",
        email: "wally@example.com",
      });

      await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: ownerId });

      expect(await inquiryById(db, beasOwn)).toMatchObject({
        name: "Bystander Bea",
        email: "bea@example.com",
        personId: bystander.id,
      });
      expect(await inquiryById(db, unlinked)).toMatchObject({
        name: "Walk-in Wally",
        email: "wally@example.com",
        personId: null,
      });
    });

    it("is tenant-scoped — another shop's lead is untouched", async () => {
      const { db, shop, diver, ownerId } = await erasableDiver();
      const [rival] = await db
        .insert(shops)
        .values({ name: "Rival Reef", slug: "rival-reef-inquiry-link", timezone: "UTC" })
        .returning();
      if (!rival) throw new Error("rival shop insert failed");
      const [rivalCourse] = await db
        .insert(courses)
        .values({ shopId: rival.id, slug: "rival-open-water", title: "Open Water" })
        .returning();
      if (!rivalCourse) throw new Error("rival course insert failed");
      // A row in the rival's shop carrying *our* diver's person id is not a
      // state the app can reach, so this pins the query's own scoping: the
      // sweep must key on shop as well as person.
      const [foreign] = await db
        .insert(courseInquiries)
        .values({
          shopId: rival.id,
          courseId: rivalCourse.id,
          personId: diver.id,
          name: "Erasure Elena",
          email: "elena@example.com",
          phone: "+1 305 555 0142",
          experienceLevel: "certified",
          message: "Same person, other shop's lead",
        })
        .returning();
      if (!foreign) throw new Error("rival inquiry insert failed");

      await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: ownerId });

      expect(await inquiryById(db, foreign.id)).toMatchObject({
        name: "Erasure Elena",
        email: "elena@example.com",
        message: "Same person, other shop's lead",
      });
    });
  });
});

describe("findSimilarDivers name similarity and exact matching", () => {
  it("finds exact and case-insensitive name matches, and similar names using trigram similarity", async () => {
    const { db, shop } = ctx;

    // Create a diver to match
    const baseDiver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Johnathan Doe",
      email: "johndoe@example.com",
    });
    expect(baseDiver).not.toBeNull();

    // Exact case-insensitive match
    const exactMatches = await findSimilarDivers(db, shop.id, "johnathan doe");
    expect(exactMatches).toHaveLength(1);
    expect(exactMatches[0].fullName).toBe("Johnathan Doe");

    // Similar match (typo / abbreviation)
    const similarMatches = await findSimilarDivers(db, shop.id, "Jonathan Do");
    expect(similarMatches).toHaveLength(1);
    expect(similarMatches[0].fullName).toBe("Johnathan Doe");

    // Unrelated name should not match
    const noMatches = await findSimilarDivers(db, shop.id, "Jane Smith");
    expect(noMatches).toHaveLength(0);
  });
});
