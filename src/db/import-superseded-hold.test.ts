import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { effectiveWaiverForBooking, waiverStanding } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { commitContactImport } from "@/test/words-wiring";
import type { AppDb } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { bookings, people, trips, userAccounts, waiverRecords, waiverTemplates } from "./schema";
import { listSignedWaiversByPerson } from "./waivers";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

async function personByEmail(db: AppDb, shopId: string, email: string) {
  const [row] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.email, email), isNull(people.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function accountPersonId(db: AppDb, email: string) {
  const [account] = await db
    .select({ personId: userAccounts.personId })
    .from(userAccounts)
    .where(eq(userAccounts.email, email))
    .limit(1);
  if (!account) throw new Error(`no account for ${email}`);
  return account.personId;
}

/**
 * **Superseding never ends a hold** (issue #3780). A refusal the owner
 * retired, or a referral a rider's fresh link moved off its seat, still
 * outranks every signature older than it. An import that looked only at live
 * records wrote a clean release dated today over it, and the diver read
 * "Signed" on every other seat.
 */
describe("a superseded hold (issue #3780)", () => {
  async function heldDiver(email: string, fullName: string) {
    const { db, shop } = ctx;
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    await commitContactImport(
      db,
      shop.id,
      prepareContactImport(`full_name,email\n${fullName},${email}`),
      importer,
    );
    const person = await personByEmail(db, shop.id, email);
    if (!person) throw new Error("person not created");
    const [template] = await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id));
    if (!template) throw new Error("no template");
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .orderBy(trips.id)
      .limit(1);
    if (!trip) throw new Error("expected a seeded departure");
    return { db, shop, importer, person, template, tripId: trip.id };
  }

  async function seatFor(
    db: AppDb,
    shopId: string,
    tripId: string,
    personId: string,
    bookedAs: "diver" | "rider" = "diver",
  ) {
    const [booking] = await db
      .insert(bookings)
      .values({ bookedAs, shopId, tripId, personId })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("fixture insert failed");
    return booking.id;
  }

  function heldRecord(input: {
    shopId: string;
    personId: string;
    bookingId: string | null;
    template: typeof waiverTemplates.$inferSelect;
    refusedBy?: string;
    signedAt: Date;
  }) {
    const { template } = input;
    return {
      shopId: input.shopId,
      bookingId: input.bookingId,
      personId: input.personId,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateGeneration: template.materialGeneration,
      templateBody: template.body,
      status: "medical_review" as const,
      tokenHash: `held-${input.personId}-${input.signedAt.getTime()}-${input.bookingId}`,
      expiresAt: input.signedAt,
      signedName: "Held Diver",
      signatureMethod: "typed_consent" as const,
      consentedAt: input.signedAt,
      signedAt: input.signedAt,
      completedAt: input.signedAt,
      medicalReviewRequired: true,
      supersededAt: nowDate(),
      ...(input.refusedBy
        ? {
            medicalClearanceDeclinedAt: input.signedAt,
            medicalClearanceDeclinedByPersonId: input.refusedBy,
            medicalClearanceEvaluatedOn: "2026-06-01",
            medicalClearancePhysicianName: "Dr. Ruiz",
          }
        : {}),
    };
  }

  const readsOnAnotherSeat = async (db: AppDb, shopId: string, personId: string) => {
    const evidence = (await listSignedWaiversByPerson(db, shopId, [personId])).get(personId);
    const [template] = await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shopId));
    return waiverStanding(
      effectiveWaiverForBooking({
        bookingWaiver: null,
        personSignedWaivers: evidence ?? [],
        currentTemplateVersion: template?.materialGeneration ?? null,
        now: nowDate(),
      }),
      nowDate(),
    );
  };

  it.each([
    ["with no seat", false],
    ["on the diver's own seat", true],
  ])("never imports a release over a retired refusal %s", async (_label, onSeat) => {
    const fixture = await heldDiver(
      `retired.${onSeat ? "seat" : "none"}@example.com`,
      "Retired Rhea",
    );
    const { db, shop, importer, person, template, tripId } = fixture;
    const bookingId = onSeat ? await seatFor(db, shop.id, tripId, person.id) : null;
    await db.insert(waiverRecords).values(
      heldRecord({
        shopId: shop.id,
        personId: person.id,
        bookingId,
        template,
        refusedBy: importer,
        signedAt: new Date(nowDate().getTime() - 24 * 60 * 60 * 1000),
      }),
    );
    expect(await readsOnAnotherSeat(db, shop.id, person.id)).toBe("medical_not_cleared");

    // No date: the commit would stamp the import itself, newer than the refusal.
    const summary = await commitContactImport(
      db,
      shop.id,
      prepareContactImport(`full_name,email,waiver_accepted\nRetired Rhea,${person.email},yes`),
      importer,
    );
    expect(summary).toMatchObject({ waiversAdded: 0, waiversSkippedExisting: 1 });
    expect(await readsOnAnotherSeat(db, shop.id, person.id)).toBe("medical_not_cleared");
    const records = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(records).toHaveLength(1);
  });

  it("never imports a release over a referral a rider's fresh link superseded", async () => {
    const { db, shop, importer, person, template, tripId } = await heldDiver(
      "rider.referral@example.com",
      "Rider Rafe",
    );
    const bookingId = await seatFor(db, shop.id, tripId, person.id, "rider");
    await db.insert(waiverRecords).values(
      heldRecord({
        shopId: shop.id,
        personId: person.id,
        bookingId,
        template,
        signedAt: new Date(nowDate().getTime() - 60 * 60 * 1000),
      }),
    );
    const summary = await commitContactImport(
      db,
      shop.id,
      prepareContactImport(
        `full_name,email,waiver_accepted,waiver_signed_at\nRider Rafe,${person.email},yes,2026-10-22`,
      ),
      importer,
    );
    expect(summary).toMatchObject({ waiversAdded: 0, waiversSkippedExisting: 1 });
    expect(await readsOnAnotherSeat(db, shop.id, person.id)).toBe("medical_review");
  });

  /**
   * The seat rule `listSignedWaiversByPerson` uses: a superseded record given
   * on a seat that now belongs to somebody else was someone else's answers,
   * so it neither holds this diver nor blocks their import.
   */
  it("imports past a superseded referral given on another diver's seat", async () => {
    const { db, shop, importer, person, template, tripId } = await heldDiver(
      "claimed.seat@example.com",
      "Claimed Cleo",
    );
    const [other] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Seat Holder", email: "seat.holder@example.com" })
      .returning({ id: people.id });
    if (!other) throw new Error("fixture insert failed");
    const bookingId = await seatFor(db, shop.id, tripId, other.id);
    await db.insert(waiverRecords).values(
      heldRecord({
        shopId: shop.id,
        personId: person.id,
        bookingId,
        template,
        signedAt: new Date(nowDate().getTime() - 60 * 60 * 1000),
      }),
    );
    const summary = await commitContactImport(
      db,
      shop.id,
      prepareContactImport(`full_name,email,waiver_accepted\nClaimed Cleo,${person.email},yes`),
      importer,
    );
    expect(summary).toMatchObject({ waiversAdded: 1, waiversSkippedExisting: 0 });
  });

  it("imports past a superseded referral a physician cleared", async () => {
    const { db, shop, importer, person, template } = await heldDiver(
      "cleared.referral@example.com",
      "Cleared Cal",
    );
    const signedAt = new Date(nowDate().getTime() - 60 * 60 * 1000);
    await db.insert(waiverRecords).values({
      ...heldRecord({
        shopId: shop.id,
        personId: person.id,
        bookingId: null,
        template,
        signedAt,
      }),
      medicalClearedAt: signedAt,
      medicalClearedByPersonId: importer,
      medicalClearanceEvaluatedOn: "2026-06-01",
      medicalClearancePhysicianName: "Dr. Ruiz",
    });
    const summary = await commitContactImport(
      db,
      shop.id,
      prepareContactImport(`full_name,email,waiver_accepted\nCleared Cal,${person.email},yes`),
      importer,
    );
    expect(summary).toMatchObject({ waiversAdded: 1, waiversSkippedExisting: 0 });
  });
});
