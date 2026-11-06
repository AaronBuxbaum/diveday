import { and, eq, isNotNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { people, shops, waiverRecords, waiverTemplates } from "./schema";
import {
  recheckAnsweredSeal,
  recheckWaiverSeals,
  WAIVER_SEALING_SHIPPED_AT,
  waiverSealPassHealthy,
} from "./waiver-seal-checks";
import { listWaiverIntegrityAudit } from "./waivers-audit";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import { clearAnswers, now, waiverContextFor } from "./waivers-test-fixtures";

/**
 * **The seal's cached verdict** (issue #2562): written beside every seal,
 * re-written by the nightly re-check, and read by the signature log's
 * "Unsealed or changed" view. Signed legal evidence, so each way the cache could
 * lie is a case: an edit after the seal, a forged "valid", a verdict gone
 * stale between passes, an erasure or merge that would launder a broken seal,
 * and a row that never had a seal.
 */
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);
// After every seeded check time, which the seed stamps from its own clock.
const later = new Date("2099-01-01T00:00:00.000Z");

async function signedRelease() {
  const ctx = await waiverContext();
  const { db, shop, booking, person } = ctx;
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  const done = await completeWaiver(db, issued.token, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: clearAnswers,
    now,
  });
  if (!done.ok) throw new Error("completion failed");
  return { ...ctx, recordId: issued.recordId };
}

async function verdictOf(db: Awaited<ReturnType<typeof waiverContext>>["db"], id: string) {
  const [row] = await db
    .select({
      valid: waiverRecords.integrityValid,
      checkedAt: waiverRecords.integrityCheckedAt,
      hash: waiverRecords.integrityHash,
    })
    .from(waiverRecords)
    .where(eq(waiverRecords.id, id));
  if (!row) throw new Error("record missing");
  return row;
}

async function inUncheckedView(
  db: Awaited<ReturnType<typeof waiverContext>>["db"],
  shopId: string,
  id: string,
) {
  const page = await listWaiverIntegrityAudit(db, shopId, { view: "unchecked", limit: 1000 });
  return page.entries.some((entry) => entry.id === id);
}

async function tamper(db: Awaited<ReturnType<typeof waiverContext>>["db"], id: string) {
  await db
    .update(waiverRecords)
    .set({ templateBody: "A release nobody agreed to." })
    .where(eq(waiverRecords.id, id));
}

describe("the seal's verdict, written when the release is sealed", () => {
  it("records a signed release as checked and valid at the moment it was sealed", async () => {
    const { db, shop, recordId } = await signedRelease();
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: true, checkedAt: now });
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(false);
  });

  it("leaves a release that was never sealed with no verdict, and in the view by its nulls", async () => {
    const { db, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    // Signed by a path that seals nothing: an import, or a row from before sealing.
    await db
      .update(waiverRecords)
      .set({ status: "completed", signedAt: now, completedAt: now })
      .where(eq(waiverRecords.id, issued.recordId));
    await recheckWaiverSeals(db, { now: later });
    expect(await verdictOf(db, issued.recordId)).toMatchObject({ valid: null, checkedAt: null });
    expect(await inUncheckedView(db, shop.id, issued.recordId)).toBe(true);
  });
});

describe("recheckWaiverSeals", () => {
  it("lists a failed seal first in the view, ahead of newer releases that were never sealed", async () => {
    const { db, shop, recordId } = await signedRelease();
    await tamper(db, recordId);
    await recheckWaiverSeals(db, { now: later });
    // Another signed release, newer and with no seal: a legacy import.
    const [legacy] = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, shop.id),
          eq(waiverRecords.status, "completed"),
          ne(waiverRecords.id, recordId),
        ),
      )
      .limit(1);
    if (!legacy) throw new Error("seeded shop has no other signed release");
    const legacyId = legacy.id;
    const newer = new Date(now.getTime() + 60 * 60 * 1000);
    await db
      .update(waiverRecords)
      .set({
        integrityHash: null,
        integrityVersion: null,
        integrityValid: null,
        integrityCheckedAt: null,
        signedAt: newer,
      })
      .where(eq(waiverRecords.id, legacyId));
    const view = await listWaiverIntegrityAudit(db, shop.id, { view: "unchecked", limit: 1000 });
    expect(view.entries[0]?.id).toBe(recordId);
    expect(view.entries.some((entry) => entry.id === legacyId)).toBe(true);
  });

  it("finds a release edited after it was sealed and puts it in the view", async () => {
    const { db, shop, recordId } = await signedRelease();
    await tamper(db, recordId);
    const summary = await recheckWaiverSeals(db, { now: later });
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: false, checkedAt: later });
    expect(summary.invalid).toBeGreaterThanOrEqual(1);
    expect(summary.newlyInvalid).toBeGreaterThanOrEqual(1);
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(true);
  });

  it("re-checks a verdict dated in the future, which would otherwise never come due", async () => {
    const { db, shop, recordId } = await signedRelease();
    await tamper(db, recordId);
    // A forged "valid" stamped far ahead (security review of #2562).
    await db
      .update(waiverRecords)
      .set({ integrityValid: true, integrityCheckedAt: new Date("9999-01-01T00:00:00.000Z") })
      .where(eq(waiverRecords.id, recordId));
    const summary = await recheckWaiverSeals(db, { now: later });
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: false, checkedAt: later });
    expect(summary.newlyInvalid).toBeGreaterThanOrEqual(1);
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(true);
    // Checked now, it is not due again in the same pass's instant.
    expect((await recheckWaiverSeals(db, { now: later })).checked).toBe(0);
  });

  it("leaves an untouched release valid and out of the view, with a fresh check time", async () => {
    const { db, shop, recordId } = await signedRelease();
    await recheckWaiverSeals(db, { now: later });
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: true, checkedAt: later });
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(false);
  });

  it("is a cache that lags: an edit since the last check reads invalid on the row before the view finds it", async () => {
    const { db, shop, recordId } = await signedRelease();
    await tamper(db, recordId);
    // Before the next pass the verdict is stale, and says so only by its time.
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: true, checkedAt: now });
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(false);
    // The row itself never trusts the cache: its badge recomputes the seal.
    const all = await listWaiverIntegrityAudit(db, shop.id, { limit: 1000 });
    expect(all.entries.find((entry) => entry.id === recordId)?.integrity).toBe("invalid");
    await recheckWaiverSeals(db, { now: later });
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(true);
  });

  it("overturns a forged verdict: a tampered row marked valid in the database is re-checked, not believed", async () => {
    const { db, shop, recordId } = await signedRelease();
    await tamper(db, recordId);
    await db
      .update(waiverRecords)
      .set({ integrityValid: true, integrityCheckedAt: now })
      .where(eq(waiverRecords.id, recordId));
    await recheckWaiverSeals(db, { now: later });
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: false, checkedAt: later });
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(true);
  });

  it("checks a forged future check time too, on the pass after it", async () => {
    const { db, recordId } = await signedRelease();
    await tamper(db, recordId);
    const future = new Date(later.getTime() + 86_400_000);
    await db
      .update(waiverRecords)
      .set({ integrityValid: true, integrityCheckedAt: future })
      .where(eq(waiverRecords.id, recordId));
    await recheckWaiverSeals(db, { now: new Date(future.getTime() + 1) });
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: false });
  });

  it("counts a seal that was already failing as invalid but not newly so", async () => {
    const { db, recordId } = await signedRelease();
    await tamper(db, recordId);
    await recheckWaiverSeals(db, { now: later });
    const again = await recheckWaiverSeals(db, { now: new Date(later.getTime() + 1) });
    expect(again.invalid).toBeGreaterThanOrEqual(1);
    expect(again.newlyInvalid).toBe(0);
  });

  /**
   * **Pre-marked as failing** (attacker review, finding 2): "already broken"
   * comes from a column the tamperer can write, so the alarm reads every
   * broken release, not only a newly broken one.
   */
  it("still raises the alarm for a tampered row pre-marked invalid in the database", async () => {
    const { db, recordId } = await signedRelease();
    await tamper(db, recordId);
    await db
      .update(waiverRecords)
      .set({ integrityValid: false, integrityCheckedAt: new Date(later.getTime() - 60_000) })
      .where(eq(waiverRecords.id, recordId));
    const pass = await recheckWaiverSeals(db, { now: later });
    expect(pass.invalid).toBeGreaterThanOrEqual(1);
    expect(waiverSealPassHealthy(pass)).toBe(false);
  });

  /**
   * **A seal removed rather than broken** (attacker review, finding 1): the
   * cheapest tamper nulls the hash. A row that carries a verdict was sealed,
   * so losing its seal is a broken seal.
   */
  it("finds a release whose seal was removed after it was checked", async () => {
    const { db, shop, recordId } = await signedRelease();
    await db
      .update(waiverRecords)
      .set({ integrityHash: null })
      .where(eq(waiverRecords.id, recordId));
    const pass = await recheckWaiverSeals(db, { now: later });
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: false, checkedAt: later });
    expect(pass.newlyInvalid).toBeGreaterThanOrEqual(1);
    expect(waiverSealPassHealthy(pass)).toBe(false);
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(true);
  });

  it("finds a release signed since sealing shipped with no seal and no verdict, but not an import", async () => {
    const { db, shop, recordId } = await signedRelease();
    const signedAt = new Date(WAIVER_SEALING_SHIPPED_AT.getTime() + 24 * 60 * 60 * 1000);
    await db
      .update(shops)
      .set({ createdAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(shops.id, shop.id));
    const stripped = {
      integrityHash: null,
      integrityVersion: null,
      integrityValid: null,
      integrityCheckedAt: null,
      signedAt,
    };
    await db.update(waiverRecords).set(stripped).where(eq(waiverRecords.id, recordId));
    await recheckWaiverSeals(db, { now: later });
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: false, checkedAt: later });

    // The same row as an import carries no seal by design, and stays unchecked.
    await db
      .update(waiverRecords)
      .set({ ...stripped, signatureMethod: "imported" })
      .where(eq(waiverRecords.id, recordId));
    await recheckWaiverSeals(db, { now: new Date(later.getTime() + 1) });
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: null, checkedAt: null });
  });

  it("reads a seal version this build does not know as invalid, never as valid", async () => {
    const { db, shop, recordId } = await signedRelease();
    await db
      .update(waiverRecords)
      .set({ integrityVersion: 99 })
      .where(eq(waiverRecords.id, recordId));
    await recheckWaiverSeals(db, { now: later });
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: false });
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(true);
  });

  /**
   * **More sealed releases than one night's limit** (dock review F2): each pass
   * stops at its limit, which is no alarm on its own, and the next night starts
   * with the rows checked longest ago, so two nights cover every row.
   */
  it("covers every release over two capped nights, and calls neither unhealthy", async () => {
    const { db } = await signedRelease();
    const sealed = and(
      isNotNull(waiverRecords.integrityHash),
      isNotNull(waiverRecords.integrityVersion),
    );
    const total = (await db.select({ id: waiverRecords.id }).from(waiverRecords).where(sealed))
      .length;
    expect(total).toBeGreaterThanOrEqual(2);
    const limit = Math.ceil(total / 2);
    const nightTwo = new Date(later.getTime() + 24 * 60 * 60 * 1000);

    const first = await recheckWaiverSeals(db, { now: later, limit, batchSize: 1 });
    const second = await recheckWaiverSeals(db, { now: nightTwo, limit, batchSize: 1 });
    for (const pass of [first, second]) {
      expect(pass).toMatchObject({ checked: limit, capped: true, newlyInvalid: 0 });
      expect(waiverSealPassHealthy(pass)).toBe(true);
    }
    const times = await db
      .select({ at: waiverRecords.integrityCheckedAt })
      .from(waiverRecords)
      .where(sealed);
    expect(times.every(({ at }) => at !== null && at.getTime() >= later.getTime())).toBe(true);
  });

  it("calls a pass unhealthy while any release it checked is broken, capped or not", () => {
    const quiet = { checked: 10, invalid: 0, acknowledged: 0, newlyInvalid: 0, capped: true };
    expect(waiverSealPassHealthy(quiet)).toBe(true);
    expect(waiverSealPassHealthy({ ...quiet, invalid: 1 })).toBe(false);
  });

  it("re-checks each row once a pass, and stops at its limit saying so", async () => {
    const { db } = await signedRelease();
    const capped = await recheckWaiverSeals(db, { now: later, limit: 1, batchSize: 1 });
    expect(capped).toMatchObject({ checked: 1, capped: true });
    // The next pass resumes; a whole pass leaves nothing due at its own time.
    const rest = await recheckWaiverSeals(db, { now: later, limit: 100_000, batchSize: 50 });
    expect(rest.capped).toBe(false);
    const stale = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(
        and(isNotNull(waiverRecords.integrityHash), isNotNull(waiverRecords.integrityVersion)),
      );
    const checked = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(eq(waiverRecords.integrityCheckedAt, later));
    expect(checked.length).toBe(stale.length);
    expect(await recheckWaiverSeals(db, { now: later })).toMatchObject({ checked: 0 });
  });

  it("keeps another shop's broken seal out of this shop's view, and in its own", async () => {
    const { db, shop } = await waiverContext();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-2562", timezone: "America/New_York" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    const [template] = await db
      .insert(waiverTemplates)
      .values({ shopId: rival.id, title: "Rival Release", body: "Rival body.", version: 1 })
      .returning();
    const [diver] = await db
      .insert(people)
      .values({ shopId: rival.id, fullName: "Rival Rae" })
      .returning();
    if (!template || !diver) throw new Error("rival fixtures missing");
    const [record] = await db
      .insert(waiverRecords)
      .values({
        shopId: rival.id,
        personId: diver.id,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateBody: template.body,
        status: "completed",
        tokenHash: "rival-2562-token-hash",
        expiresAt: now,
        signedAt: now,
        // A seal that never matched these contents.
        integrityHash: "0".repeat(64),
        integrityVersion: 1,
      })
      .returning({ id: waiverRecords.id });
    if (!record) throw new Error("rival record insert failed");
    await recheckWaiverSeals(db, { now: later });
    expect(await verdictOf(db, record.id)).toMatchObject({ valid: false });
    expect(await inUncheckedView(db, shop.id, record.id)).toBe(false);
    expect(await inUncheckedView(db, rival.id, record.id)).toBe(true);
  });
});

describe("a broken seal stays broken through the shop's own acts", () => {
  it("an erasure does not launder a tampered release: its verdict reads invalid at once", async () => {
    const { db, shop, booking, recordId } = await signedRelease();
    await tamper(db, recordId);
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")));
    if (!owner) throw new Error("seed owner missing");
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: owner.id,
    });
    if (!erased.ok) throw new Error(`erasure refused: ${erased.reason}`);
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: false });
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(true);
  });

  it("an erasure of an intact release re-seals it and records the new seal as valid", async () => {
    const { db, shop, booking, recordId } = await signedRelease();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")));
    if (!owner) throw new Error("seed owner missing");
    const before = await verdictOf(db, recordId);
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: owner.id,
    });
    if (!erased.ok) throw new Error(`erasure refused: ${erased.reason}`);
    const after = await verdictOf(db, recordId);
    expect(after.valid).toBe(true);
    expect(after.hash).not.toBe(before.hash);
    expect(await inUncheckedView(db, shop.id, recordId)).toBe(false);
  });
});

describe("recheckAnsweredSeal", () => {
  it("does nothing for a record that does not exist", async () => {
    const { db } = await signedRelease();
    await expect(
      recheckAnsweredSeal(db, "00000000-0000-4000-8000-000000000000", later),
    ).resolves.toBeUndefined();
  });

  it("leaves a record whose last verdict was valid alone, even when it has since been edited", async () => {
    const { db, recordId } = await signedRelease();
    await tamper(db, recordId);
    await recheckAnsweredSeal(db, recordId, later);
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: true, checkedAt: now });
  });

  it("never clears a failed verdict while the record still fails its seal", async () => {
    const { db, recordId } = await signedRelease();
    await tamper(db, recordId);
    await db
      .update(waiverRecords)
      .set({ integrityValid: false, integrityCheckedAt: now })
      .where(eq(waiverRecords.id, recordId));
    await recheckAnsweredSeal(db, recordId, later);
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: false, checkedAt: now });
  });

  it("clears a failed verdict only once the whole record verifies, stamping the new check", async () => {
    const { db, recordId } = await signedRelease();
    await db
      .update(waiverRecords)
      .set({ integrityValid: false, integrityCheckedAt: now })
      .where(eq(waiverRecords.id, recordId));
    await recheckAnsweredSeal(db, recordId, later);
    expect(await verdictOf(db, recordId)).toMatchObject({ valid: true, checkedAt: later });
  });
});
