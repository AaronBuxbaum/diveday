import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { waiverRecords } from "./schema";
import { setTripStatus } from "./trips";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import { saveWaiverTemplate } from "./waivers-templates";
import { clearAnswers, now, waiverContextFor } from "./waivers-test-fixtures";

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

    await saveWaiverTemplate(db, {
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
   * The openable copy exists only while the link does. Once the release is
   * signed or the link retired, a reader of the database is back to holding a
   * digest and nothing else.
   */
  it("keeps the openable copy only while the link is live", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a link");

    const [pending] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(pending?.tokenSealed).toBeTruthy();
    // Sealed, never the token itself.
    expect(pending?.tokenSealed).not.toContain(issued.token);

    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const [signed] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(signed?.status).toBe("completed");
    expect(signed?.tokenSealed).toBeNull();
  });

  it("falls back to minting a fresh link when the deployment has no sealing key", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    const { db, shop, booking } = await waiverContext();
    const first = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: new Date(now.getTime() + 60_000),
    });
    if (!first.ok || !second.ok) throw new Error("expected both links to issue");

    // Exactly the behaviour this had before reuse existed: a second issue
    // supersedes the first and the old bearer token fails closed.
    expect(second.token).not.toBe(first.token);
    expect(second.reused).toBe(false);
    expect(await getWaiverForToken(db, first.token, now)).toEqual({ state: "unavailable" });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, first.recordId));
    expect(record?.tokenSealed).toBeNull();
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
    const newer = await saveWaiverTemplate(db, {
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
});
