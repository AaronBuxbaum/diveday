import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { people, personRoles, waiverRecords, waiverSealAcknowledgements } from "./schema";
import { acknowledgeBrokenWaiverSeal } from "./waiver-seal-acknowledgements";
import { recheckWaiverSeals, waiverSealPassHealthy } from "./waiver-seal-checks";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import { clearAnswers, now, waiverContextFor } from "./waivers-test-fixtures";

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

async function brokenRelease() {
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
  await db
    .update(waiverRecords)
    .set({ templateBody: "A release nobody agreed to." })
    .where(eq(waiverRecords.id, issued.recordId));
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { ...ctx, recordId: issued.recordId, owner };
}

describe("acknowledging a broken waiver seal (#3891)", () => {
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
    await completeWaiver(db, issued.token, {
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
    const input = { shopId: shop.id, recordId, actorPersonId: owner, note: NOTE, now: later };
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
});
