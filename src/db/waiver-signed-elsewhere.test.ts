import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MINUTE_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  clearAnswers,
  issueCounterLink,
  medicalReferralAnswers,
  now,
  openOnDevice,
  shopStaffer,
  waiverContextFor,
} from "../test/substrate-fixtures/db/waivers-test-fixtures";
import { activityEvents, capabilities, people, waiverRecords } from "./schema";
import { issueAndDeliverPersonWaiver } from "./waiver-issue";
import {
  completeWaiver,
  refuseLinkSignedElsewhere,
  signedElsewhereShop,
  threadWaiverKey,
} from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";

/**
 * **Answers that came in after another door signed** (issue #4044). Since
 * #4008 a counter code and a mailed link can both name one release; when one
 * signs first, a submit through the other saves nothing, says so, and puts a
 * line on the diver's trail for the desk.
 */
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

afterEach(() => vi.unstubAllEnvs());

const signature = (name: string, medicalAnswers = clearAnswers) => ({
  signerName: name,
  agreed: true,
  medicalAnswers,
  now,
});

async function record(db: typeof fileCtx.db, id: string) {
  const [row] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, id));
  if (!row) throw new Error("record missing");
  return row;
}

async function lateAnswerLines(db: typeof fileCtx.db, personId: string) {
  return db
    .select({ actor: activityEvents.actorPersonId, params: activityEvents.params })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.subjectPersonId, personId),
        eq(activityEvents.code, "waiver_answers_after_signing"),
      ),
    );
}

/** A release with no seat, a texted release link and a claimed counter link to it. */
async function twoDoors(db: typeof fileCtx.db, shopId: string) {
  vi.stubEnv("APP_HOST", "https://diveday.example");
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: "Two Door Diver", email: "two.doors@dive.day" })
    .returning();
  if (!person) throw new Error("person insert failed");
  const mailed = await issueWaiverRequest(db, { shopId, personId: person.id, now });
  if (!mailed.ok || mailed.key.kind !== "release") throw new Error("release link refused");
  const copied = await issueAndDeliverPersonWaiver(db, shopId, person.id, {
    channel: "link",
    actorPersonId: await shopStaffer(db, shopId),
    now,
  });
  if (!copied.ok || !copied.token) throw new Error("copy link refused");
  const counter = await openOnDevice(db, copied.token, now);
  if (counter?.door !== "counter") throw new Error("counter door expected");
  return { person, mailed: mailed.key, counter: counter.key, counterToken: copied.token };
}

describe("a submit through the other door", () => {
  it("is refused as signed elsewhere, saves nothing and tells the desk", async () => {
    const { db, shop } = await waiverContext();
    const { person, mailed, counter } = await twoDoors(db, shop.id);
    expect(await completeWaiver(db, mailed, signature(person.fullName))).toMatchObject({
      ok: true,
    });
    const signed = await record(db, mailed.recordId);

    // The counter phone answered Yes to a medical question meanwhile.
    expect(
      await completeWaiver(db, counter, signature(person.fullName, medicalReferralAnswers)),
    ).toEqual({ ok: false, reason: "signed_elsewhere" });
    expect(await record(db, mailed.recordId)).toEqual(signed);
    const [counterLink] = await db
      .select({ usedAt: capabilities.usedAt })
      .from(capabilities)
      .where(eq(capabilities.id, counter.linkId));
    expect(counterLink?.usedAt).toBeNull();
    const lines = await lateAnswerLines(db, person.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      actor: person.id,
      params: { diver: person.fullName, record: mailed.recordId },
    });
  });

  it("is told by the link alone, once the page can no longer open a key", async () => {
    const { db, shop } = await waiverContext();
    const { person, mailed, counterToken } = await twoDoors(db, shop.id);
    await completeWaiver(db, mailed, signature(person.fullName));
    expect(await signedElsewhereShop(db, counterToken, now)).toEqual({ shopId: shop.id });
    expect(await refuseLinkSignedElsewhere(db, counterToken, now)).toBe(true);
    expect(await lateAnswerLines(db, person.id)).toHaveLength(1);
    // The door that signed is its own receipt, never "elsewhere".
    expect(await signedElsewhereShop(db, mailed.token, now)).toBeNull();
    expect(await refuseLinkSignedElsewhere(db, mailed.token, now)).toBe(false);
    // Nor is a dead link, or anything that is not one.
    const later = new Date(now.getTime() + 8 * 24 * 60 * MINUTE_MS);
    expect(await signedElsewhereShop(db, counterToken, later)).toBeNull();
    expect(await refuseLinkSignedElsewhere(db, "not-a-link", now)).toBe(false);
    expect(await lateAnswerLines(db, person.id)).toHaveLength(1);
  });

  it("says nothing of an unsigned release", async () => {
    const { db, shop } = await waiverContext();
    const { counterToken } = await twoDoors(db, shop.id);
    expect(await signedElsewhereShop(db, counterToken, now)).toBeNull();
  });
});

describe("a seat signed at the counter and in its own thread", () => {
  it("refuses the thread's late submit, and keeps a thread's own repeat idempotent", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id, now });
    const thread = await threadWaiverKey(db, { shopId: shop.id, bookingId: booking.id });
    const counter = await openOnDevice(db, link.token, now);
    if (!thread || counter?.door !== "counter") throw new Error("doors missing");
    expect(await completeWaiver(db, counter.key, signature(person.fullName))).toMatchObject({
      ok: true,
    });
    expect(await completeWaiver(db, thread, signature(person.fullName))).toEqual({
      ok: false,
      reason: "signed_elsewhere",
    });
    expect(await lateAnswerLines(db, person.id)).toHaveLength(1);
    // The counter's own second submit is still "already signed" (attacker review S1).
    expect(await completeWaiver(db, counter.key, signature(person.fullName))).toEqual({
      ok: false,
      reason: "already_signed",
    });

    await db
      .update(waiverRecords)
      .set({ supersededAt: now })
      .where(eq(waiverRecords.id, link.recordId));
    const reopened = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!reopened.ok) throw new Error("second release refused");
    expect(await completeWaiver(db, reopened.key, signature(person.fullName))).toMatchObject({
      ok: true,
      idempotent: false,
    });
    expect(await completeWaiver(db, reopened.key, signature(person.fullName))).toMatchObject({
      ok: true,
      idempotent: true,
    });
    expect(await lateAnswerLines(db, person.id)).toHaveLength(1);
  });
});
