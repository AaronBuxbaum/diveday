import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ANONYMIZED_PERSON_NAME } from "@/lib/anonymization";
import { RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { verifyWaiverIntegrity, WAIVER_INTEGRITY_VERSION_ERASED } from "@/lib/waiver-integrity";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { people, shops, waiverRecords, waiverTemplates } from "./schema";
import {
  getSignedWaiverRecordForShop,
  listSignedWaiversByPerson,
  listWaiverIntegrityAudit,
  WAIVER_INTEGRITY_PAGE_SIZE,
} from "./waivers-audit";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

describe("listWaiverIntegrityAudit pagination", () => {
  it("pages by number and never repeats or skips a record", async () => {
    const { db, shop } = await waiverContext();

    // The demo shop's history is well past WAIVER_INTEGRITY_PAGE_SIZE, so
    // fetch a limit large enough to get every record back as ground truth.
    const all = await listWaiverIntegrityAudit(db, shop.id, { limit: 1000 });
    expect(all.pageCount).toBe(1);
    expect(all.entries.length).toBeGreaterThan(WAIVER_INTEGRITY_PAGE_SIZE);
    expect(all.total).toBe(all.entries.length);

    const seen: string[] = [];
    const pageCount = Math.ceil(all.total / 40);
    for (let page = 1; page <= pageCount; page++) {
      const chunk = await listWaiverIntegrityAudit(db, shop.id, { page, limit: 40 });
      expect(chunk.page).toBe(page);
      expect(chunk.pageCount).toBe(pageCount);
      expect(chunk.total).toBe(all.total);
      expect(chunk.entries.length).toBeLessThanOrEqual(40);
      seen.push(...chunk.entries.map((entry) => entry.id));
    }
    expect(seen).toEqual(all.entries.map((entry) => entry.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("defaults to WAIVER_INTEGRITY_PAGE_SIZE per page and says how many pages there are", async () => {
    const { db, shop } = await waiverContext();
    const page = await listWaiverIntegrityAudit(db, shop.id);
    expect(page.entries.length).toBe(WAIVER_INTEGRITY_PAGE_SIZE);
    expect(page.pageCount).toBeGreaterThan(1);
    expect(page.total).toBeGreaterThan(WAIVER_INTEGRITY_PAGE_SIZE);
  });

  it("goes back a page as well as forward", async () => {
    const { db, shop } = await waiverContext();
    const second = await listWaiverIntegrityAudit(db, shop.id, { page: 2, limit: 5 });
    const back = await listWaiverIntegrityAudit(db, shop.id, { page: second.page - 1, limit: 5 });
    const first = await listWaiverIntegrityAudit(db, shop.id, { page: 1, limit: 5 });
    expect(back.entries.map((entry) => entry.id)).toEqual(first.entries.map((entry) => entry.id));
  });

  it("clamps a nonsensical or out-of-range page rather than showing an empty audit", async () => {
    const { db, shop } = await waiverContext();
    const first = await listWaiverIntegrityAudit(db, shop.id, { page: 1, limit: 5 });
    for (const requested of [0, -3, Number.NaN]) {
      const clamped = await listWaiverIntegrityAudit(db, shop.id, { page: requested, limit: 5 });
      expect(clamped.page).toBe(1);
      expect(clamped.entries.map((entry) => entry.id)).toEqual(
        first.entries.map((entry) => entry.id),
      );
    }

    const past = await listWaiverIntegrityAudit(db, shop.id, { page: 9_999, limit: 5 });
    expect(past.page).toBe(past.pageCount);
    expect(past.entries.length).toBeGreaterThan(0);
  });
});

/**
 * **A signed release is findable in one line** (third UX review, item 31).
 * 521 records over 27 pages had Next and Previous and nothing else; "did
 * Ling Zhao sign, and which version?" meant paging. A search on the diver
 * and two views: records whose seal cannot be checked, and records holding a
 * medical follow-up. The count narrows with the rows, so the pager and the
 * total never describe a different list from the one on screen.
 */
describe("listWaiverIntegrityAudit search and views", () => {
  async function importedRecord(ctx: Awaited<ReturnType<typeof waiverContext>>, fullName: string) {
    const { db, shop, template } = ctx;
    const [diver] = await db.insert(people).values({ shopId: shop.id, fullName }).returning();
    if (!diver) throw new Error("diver insert failed");
    const [record] = await db
      .insert(waiverRecords)
      .values({
        shopId: shop.id,
        bookingId: null,
        personId: diver.id,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateBody: template.body,
        status: "completed",
        tokenHash: `imported-${fullName}`,
        expiresAt: now,
        signedAt: now,
        importedFromLabel: "Prior shop system",
      })
      .returning({ id: waiverRecords.id });
    if (!record) throw new Error("record insert failed");
    return record.id;
  }

  it("finds a diver's records by name, and counts only those", async () => {
    const ctx = await waiverContext();
    const id = await importedRecord(ctx, "Quillon Vasquez-Orr");
    const found = await listWaiverIntegrityAudit(ctx.db, ctx.shop.id, { query: "quillon vas" });
    expect(found.entries.map((entry) => entry.id)).toEqual([id]);
    expect(found.total).toBe(1);
    expect(found.pageCount).toBe(1);
  });

  it("shows only records whose seal cannot be checked under that view", async () => {
    const ctx = await waiverContext();
    const unsealed = await importedRecord(ctx, "Unsealed Import");
    const page = await listWaiverIntegrityAudit(ctx.db, ctx.shop.id, {
      view: "unchecked",
      limit: 1000,
    });
    expect(page.entries.map((entry) => entry.id)).toContain(unsealed);
    expect(page.entries.every((entry) => entry.integrity === "unsealed")).toBe(true);
    expect(page.total).toBe(page.entries.length);
  });

  it("shows every record on a medical hold under that view", async () => {
    const ctx = await waiverContext();
    const { db, person, shop, booking } = ctx;
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    });
    const page = await listWaiverIntegrityAudit(db, shop.id, { view: "medical", limit: 1000 });
    expect(page.entries.map((entry) => entry.id)).toContain(issued.recordId);
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries.every((entry) => entry.status === "medical_review")).toBe(true);
    expect(page.total).toBe(page.entries.length);
  });

  it("combines a search with a view", async () => {
    const ctx = await waiverContext();
    await importedRecord(ctx, "Zephyrine Unsealed");
    const page = await listWaiverIntegrityAudit(ctx.db, ctx.shop.id, {
      query: "Zephyrine",
      view: "medical",
    });
    expect(page.total).toBe(0);
    expect(page.entries).toEqual([]);
  });
});

// The signature log's data (task 155, UX persona assessment Lens 17): the
// same audit, enriched with the trip a record was issued against and a
// medical-flag summary, never the raw questionnaire.
describe("listWaiverIntegrityAudit signature evidence (task 155)", () => {
  it("carries the trip and a medical-flag summary, never the raw answer set", async () => {
    const { db, person, shop, trip, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    const outcome = await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    });
    expect(outcome).toMatchObject({ ok: true, status: "medical_review" });

    const [diver] = await db.select().from(people).where(eq(people.id, booking.personId));
    if (!diver) throw new Error("booking's diver missing");

    const { entries } = await listWaiverIntegrityAudit(db, shop.id, { limit: 1000 });
    const entry = entries.find((candidate) => candidate.id === issued.recordId);
    expect(entry).toBeDefined();
    expect(entry?.personName).toBe(diver.fullName);
    expect(entry?.tripId).toBe(trip.id);
    expect(entry?.tripTitle).toBe(trip.title);
    expect(entry?.status).toBe("medical_review");
    expect(entry?.flaggedPrompts).toContain(
      RSTC_QUESTIONNAIRE.questions.find((q) => q.id === "q3")?.prompt,
    );
    // The raw questionnaire never rides along — only the flagged prompts do.
    expect(entry).not.toHaveProperty("medicalAnswers");
    expect(entry).not.toHaveProperty("tokenHash");

    // A clean signature (no medical flag) carries an empty summary, not a hole.
    // Its own database: the same seeded booking would already hold the first link.
    const {
      db: db2,
      shop: shop2,
      booking: booking2,
      person: person2,
    } = await waiverContext({
      fresh: true,
    });
    const cleanIssued = await issueWaiverRequest(db2, {
      shopId: shop2.id,
      bookingId: booking2.id,
      now,
    });
    if (!cleanIssued.ok) throw new Error("expected a second waiver link");
    await completeWaiver(db2, cleanIssued.token, {
      signerName: person2.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });
    const { entries: entries2 } = await listWaiverIntegrityAudit(db2, shop2.id, { limit: 1000 });
    const cleanEntry = entries2.find((candidate) => candidate.id === cleanIssued.recordId);
    expect(cleanEntry?.flaggedPrompts).toEqual([]);
  });

  it("shows an imported record (no booking) with no trip rather than throwing", async () => {
    const { db, shop, template } = await waiverContext();
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Imported Diver" })
      .returning();
    if (!diver) throw new Error("diver insert failed");
    await db.insert(waiverRecords).values({
      shopId: shop.id,
      bookingId: null,
      personId: diver.id,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "completed",
      tokenHash: "imported-record-token-hash",
      expiresAt: now,
      signedAt: now,
      importedFromLabel: "Prior shop system",
    });
    const { entries } = await listWaiverIntegrityAudit(db, shop.id, { limit: 1000 });
    const entry = entries.find((candidate) => candidate.personName === "Imported Diver");
    expect(entry).toBeDefined();
    expect(entry?.tripId).toBeNull();
    expect(entry?.tripTitle).toBeNull();
  });

  it("never leaks another shop's signed records, in either direction (cross-tenant)", async () => {
    const { db, shop } = await waiverContext();

    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-155", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const [rivalTemplate] = await db
      .insert(waiverTemplates)
      .values({ shopId: rival.id, title: "Rival Release", body: "Rival release body.", version: 1 })
      .returning();
    if (!rivalTemplate) throw new Error("rival template insert failed");
    const [rivalDiver] = await db
      .insert(people)
      .values({ shopId: rival.id, fullName: "Rival Rae" })
      .returning();
    if (!rivalDiver) throw new Error("rival diver insert failed");
    const [rivalRecord] = await db
      .insert(waiverRecords)
      .values({
        shopId: rival.id,
        bookingId: null,
        personId: rivalDiver.id,
        templateId: rivalTemplate.id,
        templateTitle: rivalTemplate.title,
        templateVersion: rivalTemplate.version,
        templateBody: rivalTemplate.body,
        status: "completed",
        tokenHash: "rival-record-token-hash",
        expiresAt: now,
        signedAt: now,
      })
      .returning();
    if (!rivalRecord) throw new Error("rival record insert failed");

    // Shop A's own audit (well past a page's worth of seeded history) never
    // includes the rival's record.
    const shopEntries = await listWaiverIntegrityAudit(db, shop.id, { limit: 1000 });
    expect(shopEntries.entries.some((entry) => entry.id === rivalRecord.id)).toBe(false);
    expect(shopEntries.entries.some((entry) => entry.personName === "Rival Rae")).toBe(false);

    // And the rival's own audit sees exactly its one record — not shop A's
    // 150+ seeded history, and not shop A's record ids either.
    const rivalEntries = await listWaiverIntegrityAudit(db, rival.id, { limit: 1000 });
    expect(rivalEntries.entries).toHaveLength(1);
    expect(rivalEntries.entries[0]).toMatchObject({
      id: rivalRecord.id,
      personName: "Rival Rae",
    });
    const shopRecordIds = new Set(shopEntries.entries.map((entry) => entry.id));
    expect(shopRecordIds.has(rivalRecord.id)).toBe(false);

    // getSignedWaiverRecordForShop — the roster's "View signed record" deep
    // link — is scoped exactly the same way: shop A can never resolve the
    // rival's record id, and the rival can never resolve shop A's, even
    // though both are valid record ids that genuinely exist.
    expect(await getSignedWaiverRecordForShop(db, shop.id, rivalRecord.id)).toBeNull();
    const [shopRecord] = shopEntries.entries;
    if (!shopRecord) throw new Error("shop A has no signed records to cross-check");
    expect(await getSignedWaiverRecordForShop(db, rival.id, shopRecord.id)).toBeNull();

    // Each shop resolves its own record correctly.
    expect(await getSignedWaiverRecordForShop(db, rival.id, rivalRecord.id)).toMatchObject({
      id: rivalRecord.id,
      personName: "Rival Rae",
    });
    expect(await getSignedWaiverRecordForShop(db, shop.id, shopRecord.id)).toMatchObject({
      id: shopRecord.id,
    });
  });

  it("getSignedWaiverRecordForShop finds a record past the audit's first page — the roster's deep link never silently lands on nothing", async () => {
    const { db, person, shop, trip, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    });

    // Confirm this record genuinely sits past a small page size — the
    // scenario the roster's link has to survive on a shop with real history.
    const firstPage = await listWaiverIntegrityAudit(db, shop.id, { limit: 5 });
    expect(firstPage.entries.some((entry) => entry.id === issued.recordId)).toBe(false);

    const found = await getSignedWaiverRecordForShop(db, shop.id, issued.recordId);
    expect(found).toMatchObject({
      id: issued.recordId,
      tripId: trip.id,
      status: "medical_review",
    });
    expect(found?.flaggedPrompts.length).toBeGreaterThan(0);
  });

  it("getSignedWaiverRecordForShop returns null for an unknown id instead of throwing", async () => {
    const { db, shop } = await waiverContext();
    expect(
      await getSignedWaiverRecordForShop(db, shop.id, "00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });
});

/**
 * Erasure (ADR 20260802-diver-data-erasure) is the one operation that reaches
 * into completed evidence and changes it. These tests are the waiver side of
 * that bargain: what the audit still shows, and what a bearer token can still
 * do, once a diver has been erased.
 */
describe("signed waivers after a diver is erased", () => {
  async function erasedContext(options: { completeIt: boolean; tamperBeforeErasure?: boolean }) {
    const { db, person, shop, trip, booking, template } = await waiverContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")));
    if (!owner) throw new Error("seed owner missing");

    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    if (options.completeIt) {
      const done = await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      });
      if (!done.ok) throw new Error("completion failed");
    }
    if (options.tamperBeforeErasure) {
      // An edit made straight in the database, on a field erasure keeps.
      await db
        .update(waiverRecords)
        .set({ templateBody: "A release nobody agreed to." })
        .where(eq(waiverRecords.id, issued.recordId));
    }

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: owner.id,
    });
    if (!erased.ok) throw new Error(`erasure refused: ${erased.reason}`);
    return { db, person, shop, trip, booking, template, issued, personId: booking.personId };
  }

  it("keeps the record in the integrity audit, reading as valid rather than tampered", async () => {
    const { db, shop, issued } = await erasedContext({ completeIt: true });

    const entry = await getSignedWaiverRecordForShop(db, shop.id, issued.recordId);
    expect(entry).toMatchObject({ id: issued.recordId, status: "completed", integrity: "valid" });
    // The diver's name is gone from the audit too — it is read from `people`.
    expect(entry?.personName).toBe(ANONYMIZED_PERSON_NAME);

    // And the Signatures tab it feeds shows no tampered row anywhere — the
    // failure this would look like without version 2 is every erased record
    // lighting up as altered evidence.
    const audited: Awaited<ReturnType<typeof listWaiverIntegrityAudit>>["entries"] = [];
    const first = await listWaiverIntegrityAudit(db, shop.id, { page: 1 });
    audited.push(...first.entries);
    for (let page = 2; page <= first.pageCount; page++) {
      audited.push(...(await listWaiverIntegrityAudit(db, shop.id, { page })).entries);
    }
    // (Seeded history predates sealing and reads `unsealed`; what must not
    // appear anywhere is `invalid`.)
    expect(audited.filter((row) => row.integrity === "invalid")).toEqual([]);
    expect(audited.find((row) => row.id === issued.recordId)).toMatchObject({
      integrity: "valid",
    });
  });

  it("leaves a release whose seal already failed reading as tampered, never re-sealed", async () => {
    const { db, shop, issued } = await erasedContext({
      completeIt: true,
      tamperBeforeErasure: true,
    });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    if (!record) throw new Error("record missing");
    // Erasure must not launder the edit by handing the row a fresh seal.
    expect(record.integrityVersion).not.toBe(WAIVER_INTEGRITY_VERSION_ERASED);
    expect(verifyWaiverIntegrity(record)).toBe("invalid");
    const entry = await getSignedWaiverRecordForShop(db, shop.id, issued.recordId);
    expect(entry?.integrity).toBe("invalid");
  });

  it("strips the signature and the medical questionnaire from the stored record", async () => {
    const { db, issued } = await erasedContext({ completeIt: true });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(record).toMatchObject({
      signedName: null,
      medicalAnswers: null,
      draftSignerName: null,
      draftMedicalAnswers: null,
    });
    // But the release itself — what was agreed to, and when — is still there.
    expect(record?.templateBody).toBeTruthy();
    expect(record?.signedAt).toBeInstanceOf(Date);
    expect(record?.completedAt).toBeInstanceOf(Date);
  });

  it("kills a still-pending link so its bearer can never sign against an erased diver", async () => {
    const { db, issued } = await erasedContext({ completeIt: false });

    // The token was never revealed to anyone but the fixture, and it is now
    // dead: the stored hash no longer matches it, and the record is expired
    // and superseded besides.
    expect(await getWaiverForToken(db, issued.token, now)).toEqual({ state: "unavailable" });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(record?.status).toBe("pending");
    expect(record?.supersededAt).toBeInstanceOf(Date);
    // A never-signed link is left unsealed rather than given a seal it never
    // earned — erasure must not manufacture assurance.
    expect(record?.integrityHash).toBeNull();
    expect(record ? verifyWaiverIntegrity(record) : null).toBe("unsealed");
  });

  it("cannot complete an erased diver's waiver even with the original token", async () => {
    const { db, person, issued } = await erasedContext({ completeIt: false });
    const attempt = await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });
    expect(attempt).toEqual({ ok: false, reason: "unavailable" });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(record).toMatchObject({ signedName: null, medicalAnswers: null, status: "pending" });
  });

  it("stops an erased diver's signature carrying any booking (sign-once no longer applies)", async () => {
    const { db, shop, personId } = await erasedContext({ completeIt: true });
    // The person is soft-deleted by erasure, so nothing new can be booked for
    // them and no readiness read reaches them — but the evidence they signed
    // is still on the shop's books, which is the whole point of anonymize-and-keep.
    const signed = await listSignedWaiversByPerson(db, shop.id, [personId]);
    const records = signed.get(personId) ?? [];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ signedName: null, medicalAnswers: null });
  });
});
