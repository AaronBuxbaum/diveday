import { and, eq, getTableColumns, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { now, waiverContextFor } from "../test/substrate-fixtures/db/waivers-test-fixtures";
import { people, waiverRecords, waiverTemplates } from "./schema";
import { setTripStatus } from "./trips";
import { completeWaiver, getWaiverForToken, threadWaiverKey } from "./waivers-completion";
import {
  hasLivePersonWaiverRequest,
  issueWaiverRequest,
  openWaiverInThread,
} from "./waivers-requests";
import { recordWaiverTemplate } from "./waivers-templates";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("waiver records (in-memory PGlite)", () => {
  it("keeps no link and no clock on the record", async () => {
    const { db, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    const columns = Object.keys(getTableColumns(waiverRecords));
    expect(columns).not.toContain("tokenHash");
    expect(columns).not.toContain("expiresAt");
    // Weeks on, the release still waits for its signature: the link that
    // opens it has the clock, not the record.
    const later = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    expect(await getWaiverForToken(db, issued.key, later)).toMatchObject({ state: "available" });
  });

  /**
   * Asking twice never costs a diver what they typed: a second ask keeps the
   * open release, with its draft, rather than replacing it.
   */
  it("keeps the open release on a second ask instead of opening another", async () => {
    const { db, shop, booking } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    const later = new Date(now.getTime() + 60_000);
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: later,
    });
    if (!first.ok || !second.ok) throw new Error("expected both to open");

    expect(second.recordId).toBe(first.recordId);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(await getWaiverForToken(db, first.key, later)).toMatchObject({ state: "available" });

    const records = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.bookingId, booking.id)));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: first.recordId, supersededAt: null });
  });

  /**
   * Reuse must never outlive the wording it snapshotted. A shop that edited its
   * release has withdrawn the old terms, and handing the old link back would
   * collect a signature against them.
   */
  it("supersedes rather than reuses once the shop has edited its release", async () => {
    const { db, shop, booking, template } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!first.ok) throw new Error("expected the first link to issue");

    await recordWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "Revised release: different terms entirely.",
    });

    const later = new Date(now.getTime() + 60_000);
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: later,
    });
    if (!second.ok) throw new Error("expected a fresh link on the new wording");

    expect(second.key).not.toBe(first.key);
    expect(second.reused).toBe(false);
    expect(await getWaiverForToken(db, first.key, later)).toEqual({ state: "unavailable" });

    const records = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.bookingId, booking.id)));
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.recordId, supersededAt: expect.any(Date) }),
        expect.objectContaining({ id: second.recordId, supersededAt: null }),
      ]),
    );
  });

  it("does not supersede a booking waiver when issuing a person-scoped waiver", async () => {
    const { db, shop, booking } = await waiverContext();
    const bookingIssued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!bookingIssued.ok) throw new Error("expected booking waiver link");

    const independentIssued = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: booking.personId,
      now: new Date(now.getTime() + 1),
    });
    if (!independentIssued.ok) throw new Error("expected independent waiver link");

    expect(await getWaiverForToken(db, bookingIssued.key, now)).toMatchObject({
      state: "available",
    });

    const [bookingRecord] = await db
      .select({ supersededAt: waiverRecords.supersededAt })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, bookingIssued.recordId));
    const [independentRecord] = await db
      .select({ supersededAt: waiverRecords.supersededAt })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, independentIssued.recordId));
    expect(bookingRecord?.supersededAt).toBeNull();
    expect(independentRecord?.supersededAt).toBeNull();
  });

  it("keeps the old template snapshot when a newer version becomes default", async () => {
    const { db, shop, booking, template } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    const newer = await recordWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially different v2 release long enough to be valid.",
    });
    expect(newer.template.version).toBe(template.version + 1);

    const state = await getWaiverForToken(db, issued.key, now);
    expect(state).toMatchObject({
      state: "available",
      record: { templateVersion: template.version, templateBody: template.body },
    });
  });

  it("refuses a cross-tenant issue attempt", async () => {
    const { db, booking } = await waiverContext();
    expect(
      await issueWaiverRequest(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId: booking.id,
        now,
      }),
    ).toEqual({ ok: false, reason: "booking_not_found" });
  });

  it("does not issue a waiver for a canceled trip", async () => {
    const { db, shop, trip, booking } = await waiverContext();
    await setTripStatus(db, shop.id, trip.id, "cancelled");
    expect(
      await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: booking.id,
        now,
      }),
    ).toEqual({ ok: false, reason: "booking_unavailable" });
  });

  /**
   * **The thread signs by record, not by token** (issue #2743): minting over a
   * live record would kill the link a staffer just sent and the draft typed
   * into it, so the thread keeps the live record.
   */
  it("keeps the live release for the thread", async () => {
    const { db, shop, trip, booking, person } = await waiverContext();
    const sent = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!sent.ok) throw new Error("expected the link to issue");
    const later = new Date(now.getTime() + 60_000);
    expect(
      await openWaiverInThread(db, {
        shopId: shop.id,
        bookingId: booking.id,
        expectedPersonId: person.id,
        expectedTripId: trip.id,
        now: later,
      }),
    ).toEqual({ ok: true, recordId: sent.recordId });
    expect(await getWaiverForToken(db, sent.key, later)).toMatchObject({ state: "available" });
    const key = await threadWaiverKey(db, { shopId: shop.id, bookingId: booking.id });
    expect(key?.recordId).toBe(sent.recordId);
  });

  it("opens nothing in the thread for a seat on a canceled trip", async () => {
    const { db, shop, trip, booking, person } = await waiverContext();
    await setTripStatus(db, shop.id, trip.id, "cancelled");
    expect(
      await openWaiverInThread(db, {
        shopId: shop.id,
        bookingId: booking.id,
        expectedPersonId: person.id,
        expectedTripId: trip.id,
        now,
      }),
    ).toEqual({
      ok: false,
      reason: "booking_unavailable",
    });
  });

  /**
   * **A release opened for the thread outlives a week** (reviews of #2743, D1
   * and A1): it is signed on the readiness link, which the mail never gave a
   * deadline. On day 8 it still reads awaiting a signature, and the thread
   * keeps the same release.
   */
  it("keeps a thread release signable as long as the readiness link lives", async () => {
    const { db, shop, trip, booking, person } = await waiverContext();
    const opened = await openWaiverInThread(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: person.id,
      expectedTripId: trip.id,
      now,
    });
    if (!opened.ok) throw new Error(`expected a release: ${opened.reason}`);
    const dayEight = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const again = await openWaiverInThread(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: person.id,
      expectedTripId: trip.id,
      now: dayEight,
    });
    expect(again).toEqual({ ok: true, recordId: opened.recordId });
  });

  it("refuses to open a thread release for a holder or departure other than the one read", async () => {
    const { db, shop, trip, booking, person } = await waiverContext();
    const input = { shopId: shop.id, bookingId: booking.id, now };
    expect(
      await openWaiverInThread(db, {
        ...input,
        expectedPersonId: crypto.randomUUID(),
        expectedTripId: trip.id,
      }),
    ).toEqual({ ok: false, reason: "booking_not_found" });
    expect(
      await openWaiverInThread(db, {
        ...input,
        expectedPersonId: person.id,
        expectedTripId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "booking_not_found" });
  });

  it("reaches the thread's record only through its own seat", async () => {
    const { db, shop, booking } = await waiverContext();
    const sent = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!sent.ok) throw new Error("expected the link to issue");
    const forged = {
      kind: "thread" as const,
      via: "thread" as const,
      shopId: shop.id,
      bookingId: crypto.randomUUID(),
      recordId: sent.recordId,
    };
    expect(await getWaiverForToken(db, forged, now)).toEqual({ state: "unavailable" });
  });

  it("refuses a key with the right ids that this module never made", async () => {
    const { db, shop, booking } = await waiverContext();
    const sent = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!sent.ok) throw new Error("expected the link to issue");
    const minted = await threadWaiverKey(db, { shopId: shop.id, bookingId: booking.id });
    if (!minted) throw new Error("expected the seat's own key");
    // A copy carries every id the real key does, as a server action's arguments would.
    const copy = { ...minted };
    expect(await getWaiverForToken(db, copy, now)).toEqual({ state: "unavailable" });
    expect((await getWaiverForToken(db, minted, now)).state).toBe("available");
  });
});

/**
 * **A release changed after signing stands for nothing** (issue #3885): the
 * door that refuses "already completed" must not count a record whose seal
 * failed, on either scope, or the diver could never be asked to sign again.
 */
describe("who a waiver link may be issued for", () => {
  const unknown = "00000000-0000-4000-8000-000000000000";

  it("refuses a request that names neither a seat nor a person", async () => {
    const { db, shop } = await waiverContext();
    expect(await issueWaiverRequest(db, { shopId: shop.id, now })).toEqual({
      ok: false,
      reason: "person_not_found",
    });
  });

  it("refuses a person this shop does not hold, an erased one and a merged one", async () => {
    const { db, shop, booking } = await waiverContext();
    const refused = { ok: false, reason: "person_not_found" };
    expect(await issueWaiverRequest(db, { shopId: shop.id, personId: unknown, now })).toEqual(
      refused,
    );

    await db
      .update(people)
      .set({ anonymizedAt: now, deletedAt: now })
      .where(and(eq(people.id, booking.personId), eq(people.shopId, shop.id)));
    expect(
      await issueWaiverRequest(db, { shopId: shop.id, personId: booking.personId, now }),
    ).toEqual(refused);

    const [survivor] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), ne(people.id, booking.personId)))
      .limit(1);
    if (!survivor) throw new Error("expected a second person in the demo shop");
    await db
      .update(people)
      .set({
        anonymizedAt: null,
        mergedIntoPersonId: survivor.id,
        mergedAt: now,
        mergedByPersonId: survivor.id,
      })
      .where(and(eq(people.id, booking.personId), eq(people.shopId, shop.id)));
    expect(
      await issueWaiverRequest(db, { shopId: shop.id, personId: booking.personId, now }),
    ).toEqual(refused);
  });

  it("refuses a removed person when no seat is named", async () => {
    const { db, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ deletedAt: now })
      .where(and(eq(people.id, booking.personId), eq(people.shopId, shop.id)));
    expect(
      await issueWaiverRequest(db, { shopId: shop.id, personId: booking.personId, now }),
    ).toEqual({ ok: false, reason: "person_not_found" });
  });

  it("refuses a seat that is not the person or trip the caller expected", async () => {
    const { db, shop, booking } = await waiverContext();
    const refused = { ok: false, reason: "booking_not_found" };
    expect(
      await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: booking.id,
        expectedPersonId: unknown,
        now,
      }),
    ).toEqual(refused);
    expect(
      await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: booking.id,
        expectedTripId: unknown,
        now,
      }),
    ).toEqual(refused);
    // The expectations the seat does meet change nothing.
    expect(
      await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: booking.id,
        expectedPersonId: booking.personId,
        expectedTripId: booking.tripId,
        now,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("asking whether a live waiver link exists", () => {
  it("answers for a person with no seat, against the link's clock, and never for a seat", async () => {
    const { db, shop, booking } = await waiverContext();
    expect(await hasLivePersonWaiverRequest(db, shop.id, booking.personId, now)).toBe(false);

    const seat = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!seat.ok) throw new Error("expected the seat's link to issue");
    expect(await hasLivePersonWaiverRequest(db, shop.id, booking.personId, now)).toBe(false);
    const person = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: booking.personId,
      now,
    });
    if (!person.ok) throw new Error("expected the person's link to issue");
    expect(await hasLivePersonWaiverRequest(db, shop.id, booking.personId, now)).toBe(true);

    // A release link lives a week (`release_link`).
    const dead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 1);
    expect(await hasLivePersonWaiverRequest(db, shop.id, booking.personId, dead)).toBe(false);
  });

  it("reads the clock when none is given", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(now);
      const { db, shop, booking } = await waiverContext();
      await issueWaiverRequest(db, { shopId: shop.id, personId: booking.personId, now });
      expect(await hasLivePersonWaiverRequest(db, shop.id, booking.personId)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("issuing over a signed release whose seal has been checked", () => {
  async function signed(scope: "booking" | "person") {
    const { db, shop, booking, person } = await waiverContext();
    const target = scope === "booking" ? { bookingId: booking.id } : { personId: booking.personId };
    const issued = await issueWaiverRequest(db, { shopId: shop.id, ...target, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    const done = await completeWaiver(db, issued.key, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      now,
    });
    if (!done.ok) throw new Error("expected a signed release");
    return { db, shop, target, recordId: issued.recordId };
  }
  const checked = (valid: boolean) => ({ integrityValid: valid, integrityCheckedAt: now });

  for (const scope of ["booking", "person"] as const) {
    it(`refuses a ${scope} link while the signed release's seal holds`, async () => {
      const { db, shop, target, recordId } = await signed(scope);
      await db.update(waiverRecords).set(checked(true)).where(eq(waiverRecords.id, recordId));
      expect(await issueWaiverRequest(db, { shopId: shop.id, ...target, now })).toEqual({
        ok: false,
        reason: "already_completed",
      });
    });

    it(`asks for a fresh ${scope} signature once the signed release's seal has failed`, async () => {
      const { db, shop, target, recordId } = await signed(scope);
      await db.update(waiverRecords).set(checked(false)).where(eq(waiverRecords.id, recordId));
      const again = await issueWaiverRequest(db, { shopId: shop.id, ...target, now });
      if (!again.ok) throw new Error(`expected a fresh link, got ${again.reason}`);
      expect(again.recordId).not.toBe(recordId);
      expect(again.reused).toBe(false);
    });
  }
});

describe("issuing for a shop with no current release", () => {
  it("refuses with template_not_found and writes no record", async () => {
    const { db, shop, booking } = await waiverContext();
    await db
      .update(waiverTemplates)
      .set({ deletedAt: now })
      .where(eq(waiverTemplates.shopId, shop.id));
    expect(await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now })).toEqual({
      ok: false,
      reason: "template_not_found",
    });
    const records = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.bookingId, booking.id)));
    expect(records).toEqual([]);
  });
});
