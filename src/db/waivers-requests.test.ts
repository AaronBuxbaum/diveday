import { and, eq, getTableColumns, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilityExpiryFor } from "@/lib/booking-capabilities";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { createWaiverToken, hashWaiverToken, waiverLinkToken } from "@/lib/waiver-tokens";
import { fileScopedShopContext } from "@/test/db";
import { people, waiverRecords, waiverTemplates } from "./schema";
import { setTripStatus } from "./trips";
import { completeWaiver, getWaiverForToken, threadWaiverKey } from "./waivers-completion";
import {
  hasLivePersonWaiverRequest,
  hasLiveWaiverRequest,
  issueWaiverRequest,
  openWaiverInThread,
} from "./waivers-requests";
import { recordWaiverTemplate } from "./waivers-templates";
import { now, waiverContextFor } from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("waiver records (in-memory PGlite)", () => {
  it("stores only a token hash and rejects a tampered link", async () => {
    const { db, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);

    const [stored] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(stored?.tokenHash).not.toBe(issued.token);
    expect(await getWaiverForToken(db, issued.token, now)).toMatchObject({ state: "available" });
    expect(await getWaiverForToken(db, `${issued.token}tampered`, now)).toEqual({
      state: "unavailable",
    });
  });

  /**
   * The shape a shop actually produces: copy the link, paste it into their own
   * message, then tap send to be sure. Both taps must hand over the *same* URL,
   * or the one already pasted is dead (ADR
   * 20260820-waiver-links-are-reused-not-reissued).
   */
  it("hands back the same live link instead of minting a second one", async () => {
    const { db, shop, booking } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    const later = new Date(now.getTime() + 60_000);
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: later,
    });
    if (!first.ok || !second.ok) throw new Error("expected both links to issue");

    expect(second.token).toBe(first.token);
    expect(second.recordId).toBe(first.recordId);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    // The clock restarts: whoever was just handed this link gets the full
    // window, rather than whatever was left of the first send's.
    expect(second.expiresAt.getTime()).toBeGreaterThan(first.expiresAt.getTime());
    expect(await getWaiverForToken(db, first.token, later)).toMatchObject({ state: "available" });

    // One record, not two, and nothing superseded — so a draft saved against it
    // survives the second send.
    const records = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.bookingId, booking.id)));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: first.recordId, supersededAt: null });
  });

  it("mints a fresh link when the old one has expired, and does not revive the dead one", async () => {
    const { db, shop, booking } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!first.ok) throw new Error("expected the first link to issue");
    // Past the seven-day window. Reviving a link that already died is exactly
    // what a leaked URL would want, so the TTL stays a real bound.
    const afterExpiry = new Date(first.expiresAt.getTime() + 1);
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: afterExpiry,
    });
    if (!second.ok) throw new Error("expected a fresh link");

    expect(second.token).not.toBe(first.token);
    expect(second.reused).toBe(false);
    expect(await getWaiverForToken(db, first.token, afterExpiry)).toEqual({ state: "unavailable" });
    expect(await getWaiverForToken(db, second.token, afterExpiry)).toMatchObject({
      state: "available",
    });
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

    expect(second.token).not.toBe(first.token);
    expect(second.reused).toBe(false);
    expect(await getWaiverForToken(db, first.token, later)).toEqual({ state: "unavailable" });

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

  /**
   * **A waiver link is derived from its row** (#3903), as a booking link is
   * (ADR 20261104-derived-booking-link-tokens): the row keeps a digest and no
   * openable copy, and no `SECRET_ENCRYPTION_KEY` is needed to hand the same
   * link over twice.
   */
  it("derives the link from its record and stores only the digest", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    const { db, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a link");
    const [stored] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(issued.token).toBe(waiverLinkToken(issued.recordId));
    expect(stored?.tokenHash).toBe(hashWaiverToken(issued.token));
    expect(Object.keys(getTableColumns(waiverRecords))).not.toContain("tokenSealed");
    expect(JSON.stringify(stored)).not.toContain(issued.token);
  });

  it("hands back the same live link without SECRET_ENCRYPTION_KEY", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    const { db, shop, booking } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: new Date(now.getTime() + 60_000),
    });
    if (!first.ok || !second.ok) throw new Error("expected both links to issue");
    expect(second.token).toBe(first.token);
    expect(second.reused).toBe(true);
  });

  it("mints a fresh link when the record's digest no longer matches its derived link", async () => {
    // Erasure and the identity repoints retire a link by rotating its digest;
    // the derived token must not be handed out again over a record like that.
    const { db, shop, booking } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!first.ok) throw new Error("expected a link");
    await db
      .update(waiverRecords)
      .set({ tokenHash: hashWaiverToken(createWaiverToken()) })
      .where(eq(waiverRecords.id, first.recordId));
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: new Date(now.getTime() + 60_000),
    });
    if (!second.ok) throw new Error("expected a fresh link");
    expect(second.reused).toBe(false);
    expect(second.recordId).not.toBe(first.recordId);
    expect(second.token).not.toBe(first.token);
    expect(await getWaiverForToken(db, first.token, now)).toEqual({ state: "unavailable" });
  });

  /**
   * **A rotation keeps live links** (layer-2 dock review S3). The operator
   * runbook keeps the old secret as `_PREVIOUS`; a re-send the morning after
   * must hand back the link the party already shared, draft and all.
   */
  it("hands back a live link signed under the previous key after a rotation", async () => {
    vi.stubEnv("BOOKING_LINK_SECRET", `v2:${"p".repeat(40)}`);
    const { db, shop, booking } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!first.ok) throw new Error("expected a link");
    vi.stubEnv("BOOKING_LINK_SECRET", `v3:${"r".repeat(40)}`);
    vi.stubEnv("BOOKING_LINK_SECRET_PREVIOUS", `v2:${"p".repeat(40)}`);
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: new Date(now.getTime() + 60_000),
    });
    if (!second.ok) throw new Error("expected the link back");
    expect(second.reused).toBe(true);
    expect(second.token).toBe(first.token);
  });

  it("never re-sends a link signed under a key this deployment no longer holds", async () => {
    vi.stubEnv("BOOKING_LINK_SECRET", `v2:${"p".repeat(40)}`);
    const { db, shop, booking } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!first.ok) throw new Error("expected a link");
    // Two rotations on: v2 is neither current nor previous any more.
    vi.stubEnv("BOOKING_LINK_SECRET", `v4:${"s".repeat(40)}`);
    vi.stubEnv("BOOKING_LINK_SECRET_PREVIOUS", `v3:${"r".repeat(40)}`);
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: new Date(now.getTime() + 60_000),
    });
    if (!second.ok) throw new Error("expected a fresh link");
    expect(second.reused).toBe(false);
    expect(second.token).not.toBe(first.token);
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

    expect(await getWaiverForToken(db, bookingIssued.token, now)).toMatchObject({
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

    const state = await getWaiverForToken(db, issued.token, now);
    expect(state).toMatchObject({
      state: "available",
      record: { templateVersion: template.version, templateBody: template.body },
    });
  });

  it("rejects expired links and cross-tenant issue attempts", async () => {
    const { db, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    const expiredState = await getWaiverForToken(db, issued.token, issued.expiresAt);
    // Still carries the record — a dead link's page needs the shop id off of
    // it to show contact details, not just a bare "expired" flag.
    expect(expiredState.state).toBe("expired");
    expect(expiredState.state === "expired" && expiredState.record.shopId).toBe(shop.id);
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
    expect(await getWaiverForToken(db, sent.token, later)).toMatchObject({ state: "available" });
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
   * deadline. On day 8 it still reads awaiting a signature, not "link expired";
   * a waiver link issued the ordinary way keeps its week.
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
    const [record] = await db
      .select({ expiresAt: waiverRecords.expiresAt })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, opened.recordId));
    const dayEight = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(record?.expiresAt.getTime()).toBe(capabilityExpiryFor(trip.endsAt, now).getTime());
    expect(record?.expiresAt.getTime()).toBeGreaterThan(dayEight.getTime());
    // Keeping it live refreshes it to the same bound, never down to a week.
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

  it("starts a fresh release for the thread once the old one has run out", async () => {
    const { db, shop, trip, booking, person } = await waiverContext();
    const sent = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!sent.ok) throw new Error("expected the link to issue");
    const muchLater = new Date(sent.expiresAt.getTime() + 1);
    const opened = await openWaiverInThread(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: person.id,
      expectedTripId: trip.id,
      now: muchLater,
    });
    if (!opened.ok) throw new Error(`expected a fresh release: ${opened.reason}`);
    expect(opened.recordId).not.toBe(sent.recordId);
    expect(await getWaiverForToken(db, sent.token, muchLater)).toEqual({ state: "unavailable" });
  });

  it("reaches the thread's record only through its own seat", async () => {
    const { db, shop, booking } = await waiverContext();
    const sent = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!sent.ok) throw new Error("expected the link to issue");
    const forged = {
      kind: "thread" as const,
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
  it("answers for a seat, and for a person with no seat, against the clock", async () => {
    const { db, shop, booking } = await waiverContext();
    expect(await hasLiveWaiverRequest(db, booking.id, now)).toBe(false);
    expect(await hasLivePersonWaiverRequest(db, shop.id, booking.personId, now)).toBe(false);

    const seat = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    const person = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: booking.personId,
      now,
    });
    if (!seat.ok || !person.ok) throw new Error("expected both links to issue");
    expect(await hasLiveWaiverRequest(db, booking.id, now)).toBe(true);
    expect(await hasLivePersonWaiverRequest(db, shop.id, booking.personId, now)).toBe(true);

    const dead = new Date(seat.expiresAt.getTime() + 1);
    expect(await hasLiveWaiverRequest(db, booking.id, dead)).toBe(false);
    expect(await hasLivePersonWaiverRequest(db, shop.id, booking.personId, dead)).toBe(false);
  });

  it("reads the clock when none is given", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(now);
      const { db, shop, booking } = await waiverContext();
      await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
      await issueWaiverRequest(db, { shopId: shop.id, personId: booking.personId, now });
      expect(await hasLiveWaiverRequest(db, booking.id)).toBe(true);
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
    const done = await completeWaiver(db, issued.token, {
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
