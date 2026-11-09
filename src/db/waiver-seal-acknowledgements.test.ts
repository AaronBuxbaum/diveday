import { and, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { anonymizeDiver } from "../features/anonymize/store";
import {
  clearAnswers,
  now,
  waiverContextFor,
} from "../test/substrate-fixtures/db/waivers-test-fixtures";
import type { DbExecutor } from "./client";
import { getDiverMergePreview, mergeDiverRecords } from "./diver-merge";
import {
  activityEvents,
  people,
  personRoles,
  waiverRecords,
  waiverSealAcknowledgements,
} from "./schema";
import { WAIVER_SEALED_COLUMNS } from "./waiver-record-columns";
import { acknowledgeBrokenWaiverSeal, waiverSealStateDigest } from "./waiver-seal-acknowledgements";
import { recheckWaiverSeals, waiverSealPassHealthy } from "./waiver-seal-checks";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";

/**
 * **A broken seal someone has looked into** (#3891). The nightly check stays
 * red for a broken release until a manager records that they investigated it:
 * who, when and a note, appended outside `waiver_records` so the edited row
 * cannot write it. An acknowledgement covers the release as it stood when it
 * was made; a further edit, or a different release, rings again.
 */
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);
const later = new Date("2099-01-01T00:00:00.000Z");
const nightAfter = new Date(later.getTime() + 24 * 60 * 60 * 1000);
const NOTE = "Spoke to the diver; a support script rewrote the template text by mistake.";

/** The digest the page would render beside the release the manager reads. */
async function shownDigest(db: DbExecutor, recordId: string): Promise<string> {
  const [row] = await db
    .select({ record: WAIVER_SEALED_COLUMNS })
    .from(waiverRecords)
    .where(eq(waiverRecords.id, recordId));
  if (!row) throw new Error("record missing");
  return waiverSealStateDigest(row.record);
}

async function brokenRelease() {
  const ctx = await waiverContext();
  const { db, shop, booking, person } = ctx;
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  const done = await completeWaiver(db, issued.key, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: clearAnswers,
    now,
  });
  if (!done.ok) throw new Error("completion failed");
  await db
    .update(waiverRecords)
    .set({ templateBody: "A release nobody agreed to." })
    .where(eq(waiverRecords.id, issued.recordId));
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { ...ctx, recordId: issued.recordId, owner };
}

describe("acknowledging a broken waiver seal (#3891)", () => {
  async function acknowledged() {
    const ctx = await brokenRelease();
    const { db, shop, recordId, owner } = ctx;
    await recheckWaiverSeals(db, { now: later });
    await acknowledgeBrokenWaiverSeal(db, {
      shopId: shop.id,
      recordId,
      actorPersonId: owner,
      note: NOTE,
      expectedStateDigest: await shownDigest(db, recordId),
      now: later,
    });
    const quiet = await recheckWaiverSeals(db, { now: nightAfter });
    return { ...ctx, quietInvalid: quiet.invalid, quietAcknowledged: quiet.acknowledged };
  }

  it("retains an unchanged acknowledgement and open-page digest after routine key rotation", async () => {
    const a = "a".repeat(40),
      b = "b".repeat(40);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    vi.stubEnv("WAIVER_INTEGRITY_KEYS", JSON.stringify({ active: "a", keys: { a } }));
    const { db, shop, recordId, owner, quietAcknowledged } = await acknowledged();
    const expectedStateDigest = await shownDigest(db, recordId);
    vi.stubEnv("WAIVER_INTEGRITY_KEYS", JSON.stringify({ active: "b", keys: { a, b } }));
    const checked = await recheckWaiverSeals(db, {
      now: new Date(nightAfter.getTime() + 86_400_000),
    });
    expect(checked.acknowledged).toBe(quietAcknowledged);
    expect(
      await acknowledgeBrokenWaiverSeal(db, {
        shopId: shop.id,
        recordId,
        actorPersonId: owner,
        note: NOTE,
        expectedStateDigest,
        now: nightAfter,
      }),
    ).toEqual({ ok: true });
  });

  it("rings again when the diver is merged into another record (#3956)", async () => {
    const { db, shop, recordId, owner, person, quietInvalid, quietAcknowledged } =
      await acknowledged();
    const [survivor] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: person.fullName, email: "kept@example.com" })
      .returning();
    if (!survivor) throw new Error("survivor missing");
    await db.insert(personRoles).values({ personId: survivor.id, role: "diver" });
    const preview = await getDiverMergePreview(db, shop.id, person.id, survivor.id);
    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: person.id,
      survivorId: survivor.id,
      actorPersonId: owner,
      acknowledged: preview?.acknowledgement,
    });
    expect(merged.ok).toBe(true);
    const pass = await recheckWaiverSeals(db, { now: new Date(nightAfter.getTime() + 86_400_000) });
    expect(pass.invalid).toBe(quietInvalid + 1);
    expect(pass.acknowledged).toBe(quietAcknowledged - 1);
    // Acknowledging again, against the release as it now stands, quiets it once more.
    expect(
      await acknowledgeBrokenWaiverSeal(db, {
        shopId: shop.id,
        recordId,
        actorPersonId: owner,
        note: NOTE,
        expectedStateDigest: await shownDigest(db, recordId),
        now: later,
      }),
    ).toEqual({ ok: true });
    const quiet = await recheckWaiverSeals(db, {
      now: new Date(nightAfter.getTime() + 2 * 86_400_000),
    });
    expect(quiet.invalid).toBe(quietInvalid);
    expect(quiet.acknowledged).toBe(quietAcknowledged);
  });

  it("rings again when the diver is erased (#3956)", async () => {
    const { db, shop, recordId, owner, person, quietInvalid, quietAcknowledged } =
      await acknowledged();
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: person.id,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);
    const pass = await recheckWaiverSeals(db, { now: new Date(nightAfter.getTime() + 86_400_000) });
    expect(pass.invalid).toBe(quietInvalid + 1);
    expect(pass.acknowledged).toBe(quietAcknowledged - 1);
    expect(
      await acknowledgeBrokenWaiverSeal(db, {
        shopId: shop.id,
        recordId,
        actorPersonId: owner,
        note: NOTE,
        expectedStateDigest: await shownDigest(db, recordId),
        now: later,
      }),
    ).toEqual({ ok: true });
    const quiet = await recheckWaiverSeals(db, {
      now: new Date(nightAfter.getTime() + 2 * 86_400_000),
    });
    expect(quiet.invalid).toBe(quietInvalid);
  });

  it("records who, when and why, outside the waiver row, and turns the check green", async () => {
    const { db, shop, recordId, owner } = await brokenRelease();
    const before = await recheckWaiverSeals(db, { now: later });
    expect(before.invalid).toBeGreaterThanOrEqual(1);
    expect(
      await acknowledgeBrokenWaiverSeal(db, {
        shopId: shop.id,
        recordId,
        actorPersonId: owner,
        note: `  ${NOTE}  `,
        expectedStateDigest: await shownDigest(db, recordId),
        now: later,
      }),
    ).toEqual({ ok: true });
    const [ack] = await db
      .select()
      .from(waiverSealAcknowledgements)
      .where(eq(waiverSealAcknowledgements.waiverRecordId, recordId));
    expect(ack).toMatchObject({
      shopId: shop.id,
      acknowledgedByPersonId: owner,
      note: NOTE,
      acknowledgedAt: later,
    });
    const pass = await recheckWaiverSeals(db, { now: nightAfter });
    expect(pass.checked).toBe(before.checked);
    expect(pass.invalid).toBe(before.invalid - 1);
    expect(pass.acknowledged).toBe(before.acknowledged + 1);
    if (before.invalid === 1) expect(waiverSealPassHealthy(pass)).toBe(true);
    // The verdict on the row stays false: an acknowledgement is not a repair.
    const [row] = await db
      .select({ valid: waiverRecords.integrityValid })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, recordId));
    expect(row?.valid).toBe(false);
  });

  it("rings again when the acknowledged release is edited further", async () => {
    const { db, shop, recordId, owner } = await brokenRelease();
    await recheckWaiverSeals(db, { now: later });
    await acknowledgeBrokenWaiverSeal(db, {
      shopId: shop.id,
      recordId,
      actorPersonId: owner,
      note: NOTE,
      expectedStateDigest: await shownDigest(db, recordId),
      now: later,
    });
    await db
      .update(waiverRecords)
      .set({ signedName: "Somebody else" })
      .where(eq(waiverRecords.id, recordId));
    const pass = await recheckWaiverSeals(db, { now: nightAfter });
    expect(pass.invalid).toBeGreaterThanOrEqual(1);
    expect(waiverSealPassHealthy(pass)).toBe(false);
  });

  it("will not acknowledge a seal that is not broken", async () => {
    const ctx = await waiverContext();
    const { db, shop, booking, person } = ctx;
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("issue failed");
    await completeWaiver(db, issued.key, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    expect(
      await acknowledgeBrokenWaiverSeal(db, {
        shopId: shop.id,
        recordId: issued.recordId,
        actorPersonId: owner,
        note: NOTE,
        expectedStateDigest: await shownDigest(db, issued.recordId),
        now: later,
      }),
    ).toEqual({ ok: false, reason: "not_broken" });
  });

  it("refuses a staffer who may not manage waivers, another shop, and an empty note", async () => {
    const { db, shop, recordId, owner } = await brokenRelease();
    await recheckWaiverSeals(db, { now: later });
    const [crew] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Deckhand Dee" })
      .returning({ id: people.id });
    if (!crew) throw new Error("crew insert failed");
    await db.insert(personRoles).values({ personId: crew.id, role: "divemaster" });
    const input = {
      shopId: shop.id,
      recordId,
      actorPersonId: owner,
      note: NOTE,
      expectedStateDigest: await shownDigest(db, recordId),
      now: later,
    };
    expect(await acknowledgeBrokenWaiverSeal(db, { ...input, actorPersonId: crew.id })).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(
      await acknowledgeBrokenWaiverSeal(db, {
        ...input,
        shopId: "00000000-0000-0000-0000-000000000000",
      }),
    ).toEqual({ ok: false, reason: "not_authorized" });
    expect(await acknowledgeBrokenWaiverSeal(db, { ...input, note: "   " })).toEqual({
      ok: false,
      reason: "note_required",
    });
    expect(
      await db
        .select()
        .from(waiverSealAcknowledgements)
        .where(
          and(
            eq(waiverSealAcknowledgements.waiverRecordId, recordId),
            eq(waiverSealAcknowledgements.shopId, shop.id),
          ),
        ),
    ).toEqual([]);
  });

  it("refuses when the release changed between what the manager read and the write", async () => {
    const { db, shop, recordId, owner } = await brokenRelease();
    await recheckWaiverSeals(db, { now: later });
    const read = await shownDigest(db, recordId);
    // A second edit lands while the manager is reading the first.
    await db
      .update(waiverRecords)
      .set({ signedName: "Somebody else" })
      .where(eq(waiverRecords.id, recordId));
    expect(
      await acknowledgeBrokenWaiverSeal(db, {
        shopId: shop.id,
        recordId,
        actorPersonId: owner,
        note: NOTE,
        expectedStateDigest: read,
        now: later,
      }),
    ).toEqual({ ok: false, reason: "changed" });
    expect(
      await db
        .select()
        .from(waiverSealAcknowledgements)
        .where(eq(waiverSealAcknowledgements.waiverRecordId, recordId)),
    ).toEqual([]);
  });

  it("writes who quietened the alarm on the diver's trail, in the same write", async () => {
    const { db, shop, recordId, owner, person } = await brokenRelease();
    await recheckWaiverSeals(db, { now: later });
    await acknowledgeBrokenWaiverSeal(db, {
      shopId: shop.id,
      recordId,
      actorPersonId: owner,
      note: NOTE,
      expectedStateDigest: await shownDigest(db, recordId),
      now: later,
    });
    const lines = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.shopId, shop.id),
          eq(activityEvents.code, "waiver_seal_acknowledged"),
          eq(activityEvents.subjectPersonId, person.id),
        ),
      );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ actorPersonId: owner, params: { record: recordId } });
  });

  it("keeps who and when but not the note's words when the diver is erased", async () => {
    const { db, shop, recordId, owner, person } = await brokenRelease();
    await recheckWaiverSeals(db, { now: later });
    await acknowledgeBrokenWaiverSeal(db, {
      shopId: shop.id,
      recordId,
      actorPersonId: owner,
      note: "Q4 (asthma) changed Yes to No in the database; she does have asthma.",
      expectedStateDigest: await shownDigest(db, recordId),
      now: later,
    });
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: person.id,
      actorPersonId: owner,
    });
    expect(erased.ok).toBe(true);
    const [ack] = await db
      .select()
      .from(waiverSealAcknowledgements)
      .where(eq(waiverSealAcknowledgements.waiverRecordId, recordId));
    expect(ack).toMatchObject({ note: "[redacted]", acknowledgedByPersonId: owner });
  });
});
