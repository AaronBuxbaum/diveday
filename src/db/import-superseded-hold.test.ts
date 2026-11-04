import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { effectiveWaiverForBooking, waiverStanding } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { commitContactImport } from "@/test/words-wiring";
import type { AppDb } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { getDiverMergePreview, mergeDiverRecords } from "./diver-merge";
import {
  activityEvents,
  bookings,
  people,
  personRoles,
  trips,
  userAccounts,
  waiverRecords,
  waiverTemplates,
} from "./schema";
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

/**
 * **A merge never puts an imported release over a medical hold** (issue
 * #3815). The import checks for a hold only when it writes, and a contact row
 * under another email matches nobody: it makes a new person, who has no hold,
 * and a clean `imported` release dated now. Merging that person into the diver
 * who has the hold moved the release across, newer than the referral, and
 * every seat with no record of its own read Signed.
 */
describe("merging a duplicate over a medical hold (issue #3815)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function twoRecords(email: string) {
    const { db, shop } = ctx;
    const importer = await accountPersonId(db, DEV_STAFF_LOGINS.owner.email);
    const [template] = await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id));
    if (!template) throw new Error("no template");
    const [rhea] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Rhea Held", email: `rhea.${email}` })
      .returning();
    if (!rhea) throw new Error("fixture insert failed");
    await db.insert(personRoles).values({ personId: rhea.id, role: "diver" });
    return { db, shop, importer, template, rhea, duplicateEmail: `dup.${email}` };
  }

  const refusal = (f: Awaited<ReturnType<typeof twoRecords>>, ageDays = 1, retired = true) => ({
    shopId: f.shop.id,
    bookingId: null,
    personId: f.rhea.id,
    templateId: f.template.id,
    templateTitle: f.template.title,
    templateVersion: f.template.version,
    templateGeneration: f.template.materialGeneration,
    templateBody: f.template.body,
    status: "medical_review" as const,
    tokenHash: `refusal-${f.rhea.id}-${ageDays}`,
    expiresAt: nowDate(),
    signedName: "Rhea Held",
    signatureMethod: "typed_consent" as const,
    consentedAt: new Date(nowDate().getTime() - ageDays * DAY),
    signedAt: new Date(nowDate().getTime() - ageDays * DAY),
    completedAt: new Date(nowDate().getTime() - ageDays * DAY),
    medicalReviewRequired: true,
    supersededAt: retired ? nowDate() : null,
    medicalClearanceDeclinedAt: new Date(nowDate().getTime() - ageDays * DAY),
    medicalClearanceDeclinedByPersonId: f.importer,
    medicalClearanceEvaluatedOn: "2026-06-01",
    medicalClearancePhysicianName: "Dr. Ruiz",
  });

  /** A contact import under a different email: matches nobody, so it mints a person and a release. */
  async function importDuplicate(f: Awaited<ReturnType<typeof twoRecords>>) {
    await commitContactImport(
      f.db,
      f.shop.id,
      prepareContactImport(`full_name,email,waiver_accepted\nRhea Held,${f.duplicateEmail},yes`),
      f.importer,
    );
    const duplicate = await personByEmail(f.db, f.shop.id, f.duplicateEmail);
    if (!duplicate) throw new Error("the import made no person");
    return duplicate;
  }

  async function mergeInto(
    f: Awaited<ReturnType<typeof twoRecords>>,
    sourceId: string,
    survivorId: string,
  ) {
    const preview = await getDiverMergePreview(f.db, f.shop.id, sourceId, survivorId);
    return mergeDiverRecords({
      db: f.db,
      shopId: f.shop.id,
      personId: sourceId,
      survivorId,
      actorPersonId: f.importer,
      acknowledged: preview?.acknowledgement || undefined,
    });
  }

  const standing = async (f: Awaited<ReturnType<typeof twoRecords>>, personId: string) => {
    const evidence = (await listSignedWaiversByPerson(f.db, f.shop.id, [personId])).get(personId);
    return waiverStanding(
      effectiveWaiverForBooking({
        bookingWaiver: null,
        personSignedWaivers: evidence ?? [],
        currentTemplateVersion: f.template.materialGeneration,
        now: nowDate(),
      }),
      nowDate(),
    );
  };

  const trail = (f: Awaited<ReturnType<typeof twoRecords>>, personId: string) =>
    f.db
      .select({ params: activityEvents.params, actor: activityEvents.actorPersonId })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.subjectPersonId, personId),
          eq(activityEvents.code, "diver_merge_import_set_aside"),
        ),
      );

  it.each([
    ["a retired refusal", true],
    ["a refusal nobody retired", false],
  ])("keeps %s governing the diver's other seats", async (_label, retired) => {
    const f = await twoRecords(`kept.${retired}@example.com`);
    await f.db.insert(waiverRecords).values(refusal(f, 1, retired));
    const duplicate = await importDuplicate(f);
    // The duplicate alone reads Signed: nothing held it.
    expect(await standing(f, duplicate.id)).toBe("signed");

    expect(await mergeInto(f, duplicate.id, f.rhea.id)).toMatchObject({ ok: true });

    expect(await standing(f, f.rhea.id)).toBe("medical_not_cleared");
    const [imported] = await f.db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.personId, f.rhea.id), eq(waiverRecords.signatureMethod, "imported")),
      );
    expect(imported?.supersededAt).not.toBeNull();
    // Set aside, not erased: the record and its seal stay on the diver.
    expect(imported?.status).toBe("completed");
    const lines = await trail(f, f.rhea.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ actor: f.importer, params: { merged: "Rhea Held" } });
  });

  it("keeps the hold governing when the hold is the record that moves", async () => {
    // The mirror: the kept record already holds the imported release, and the
    // referral arrives from the record merged away.
    const f = await twoRecords("mirror@example.com");
    const keeper = await importDuplicate(f);
    await f.db.insert(waiverRecords).values({ ...refusal(f), personId: f.rhea.id });
    expect(await standing(f, keeper.id)).toBe("signed");

    expect(await mergeInto(f, f.rhea.id, keeper.id)).toMatchObject({ ok: true });

    expect(await standing(f, keeper.id)).toBe("medical_not_cleared");
    expect(await trail(f, keeper.id)).toHaveLength(1);
  });

  it("leaves an imported release alone when no hold stands over it", async () => {
    const f = await twoRecords("clean@example.com");
    const duplicate = await importDuplicate(f);
    expect(await mergeInto(f, duplicate.id, f.rhea.id)).toMatchObject({ ok: true });
    expect(await standing(f, f.rhea.id)).toBe("signed");
    expect(await trail(f, f.rhea.id)).toHaveLength(0);
  });

  it("leaves an imported release alone over a referral a physician cleared", async () => {
    const f = await twoRecords("cleared@example.com");
    const cleared = {
      ...refusal(f),
      medicalClearanceDeclinedAt: null,
      medicalClearanceDeclinedByPersonId: null,
      medicalClearedAt: new Date(nowDate().getTime() - DAY),
      medicalClearedByPersonId: f.importer,
    };
    await f.db.insert(waiverRecords).values(cleared);
    const duplicate = await importDuplicate(f);
    expect(await mergeInto(f, duplicate.id, f.rhea.id)).toMatchObject({ ok: true });
    expect(await standing(f, f.rhea.id)).toBe("signed");
    expect(await trail(f, f.rhea.id)).toHaveLength(0);
  });

  it("leaves an imported release older than the referral where the hold already governs", async () => {
    const f = await twoRecords("older@example.com");
    await f.db.insert(waiverRecords).values(refusal(f, 1));
    const duplicate = await importDuplicate(f);
    // The release claims a date before the referral: the hold already outranks it.
    await f.db
      .update(waiverRecords)
      .set({ signedAt: new Date(nowDate().getTime() - 5 * DAY) })
      .where(eq(waiverRecords.personId, duplicate.id));
    expect(await mergeInto(f, duplicate.id, f.rhea.id)).toMatchObject({ ok: true });
    const [imported] = await f.db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.personId, f.rhea.id), eq(waiverRecords.signatureMethod, "imported")),
      );
    expect(imported?.supersededAt).toBeNull();
    expect(await standing(f, f.rhea.id)).toBe("medical_not_cleared");
  });

  it("never sets aside a release the diver signed themselves after the referral", async () => {
    const f = await twoRecords("signed@example.com");
    await f.db.insert(waiverRecords).values(refusal(f, 2));
    const duplicate = await importDuplicate(f);
    // A real signature on the duplicate, newer than the referral, and no import.
    await f.db
      .update(waiverRecords)
      .set({ signatureMethod: "typed_consent" })
      .where(eq(waiverRecords.personId, duplicate.id));
    expect(await mergeInto(f, duplicate.id, f.rhea.id)).toMatchObject({ ok: true });
    expect(await standing(f, f.rhea.id)).toBe("signed");
    expect(await trail(f, f.rhea.id)).toHaveLength(0);
  });
});
