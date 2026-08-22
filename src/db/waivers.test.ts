import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANONYMIZED_PERSON_NAME } from "@/lib/anonymization";
import { STAFF_ROLES } from "@/lib/authz";
import { emptyMedicalAnswers, findQuestionnaireVersion, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { DEFAULT_WAIVER_TITLE, WAIVER_SIGNATURE_VALIDITY_MS } from "@/lib/waivers";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { getBookingReadiness } from "./readiness";
import { people, personRoles, shops, userAccounts, waiverRecords, waiverTemplates } from "./schema";
import { getTripRoster, listStaff, setTripStatus, upcomingTripsWithCounts } from "./trips";
import {
  completeWaiver,
  countSignedWaiversOnCurrentVersion,
  getCurrentWaiverTemplate,
  getEmergencyContactForBooking,
  getSignedWaiverRecordForShop,
  getWaiverForToken,
  issueWaiverRequest,
  listSignedWaiversByPerson,
  listWaiverIntegrityAudit,
  listWaiverTemplateHistory,
  recordInPersonWaiver,
  saveBookingEmergencyContact,
  saveWaiverTemplate,
  WAIVER_INTEGRITY_PAGE_SIZE,
} from "./waivers";

const now = new Date("2026-07-18T12:00:00.000Z");

afterEach(() => {
  vi.unstubAllEnvs();
});
const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
const medicalReferralAnswers = {
  ...clearAnswers,
  responses: { ...clearAnswers.responses, q3: true },
};

async function waiverContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((row) => row.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("demo trip missing");
  const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
  if (!rosterEntry) throw new Error("demo booking missing");
  const template = await getCurrentWaiverTemplate(db, shop.id);
  if (!template) throw new Error("demo waiver template missing");
  // The diver the booking belongs to: `completeWaiver` now checks the typed
  // signature against this name, so every completion in these tests signs as
  // the person actually holding the seat.
  return {
    db,
    shop,
    trip,
    booking: rosterEntry.booking,
    person: rosterEntry.person,
    template,
  };
}

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

  it("makes completion idempotent and routes a medical yes to review", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    const input = {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    };
    expect(await completeWaiver(db, issued.token, input)).toEqual({
      ok: true,
      status: "medical_review",
      idempotent: false,
    });
    expect(await completeWaiver(db, issued.token, input)).toEqual({
      ok: true,
      status: "medical_review",
      idempotent: true,
    });
  });

  it("clears a question 1 yes when every Box A answer is no", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    const medicalAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
    medicalAnswers.responses.q1 = true;
    for (const question of RSTC_QUESTIONNAIRE.questions.filter((q) => q.parentId === "q1")) {
      medicalAnswers.responses[question.id] = false;
    }
    expect(
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
  });

  /**
   * **Readable is not signable.** v2 stays in `findQuestionnaireVersion` so an
   * already-signed record can still be interpreted under the questions its
   * diver actually answered. It must never be a set of questions somebody can
   * sign *today*: `completeWaiver` takes the version from the client, so
   * without `requireCurrent` a caller could answer the corrected form under the
   * version it corrected — and v2's dental question is exactly the item v3
   * moved into Box C behind a question 4 yes. An all-no v2 set computes
   * `clear`, so this is refused for its version and nothing else.
   */
  it("refuses a retired questionnaire version for a new signature", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    const retired = findQuestionnaireVersion(RSTC_QUESTIONNAIRE.id, 2);
    if (!retired) throw new Error("v2 must stay readable for already-signed records");

    expect(
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: emptyMedicalAnswers(retired),
        now,
      }),
    ).toEqual({ ok: false, reason: "invalid_medical" });
    // Refused before the record was touched, like every other refusal here:
    // the diver comes back to a link they can still sign under v3.
    expect(await getWaiverForToken(db, issued.token, now)).toMatchObject({ state: "available" });

    expect(
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
  });

  /**
   * "Type your full name" *is* the signature, so it has to be the signer's
   * name. It used to accept any two characters, which meant a release could be
   * executed under "asdf" and still read as signed on the manifest.
   */
  it("refuses a signature typed under someone else's name, leaving the link signable", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");

    expect(
      await completeWaiver(db, issued.token, {
        signerName: "Somebody Else",
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toEqual({ ok: false, reason: "name_mismatch" });
    // Refused before the record was touched: the diver can still sign.
    expect(await getWaiverForToken(db, issued.token, now)).toMatchObject({ state: "available" });

    expect(
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
  });

  it("accepts the noise that isn't a different person — case, accents, and a middle initial", async () => {
    const { db, shop, booking, person } = await waiverContext();
    await db.update(people).set({ fullName: "José Q. Díaz" }).where(eq(people.id, person.id));
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");

    expect(
      await completeWaiver(db, issued.token, {
        signerName: "  jose diaz ",
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
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

  it("does not issue a waiver for a cancelled trip", async () => {
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
   * The demo shop ships with superseded wordings already on file
   * (src/db/seed-waiver-versions.ts), so an edit here counts on from whatever
   * version the seed left live rather than from 1. Written against
   * `template.version` on purpose: what these assert is that saving *appends*
   * and that the newest row is current, which is true whatever the shop's
   * history happens to be — pinning the literal would make them a restatement
   * of the seed instead.
   */
  it("saves each edit as the next version and points new links at the current one", async () => {
    const { db, shop, template } = await waiverContext();
    const seeded = template.version;
    expect(seeded).toBeGreaterThan(0);

    const next = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "An updated release, edited by staff and long enough to be valid.",
    });
    expect(next.template.version).toBe(seeded + 1);

    // The newest version is always current.
    const currentNow = await getCurrentWaiverTemplate(db, shop.id);
    expect(currentNow?.id).toBe(next.template.id);
    const history = await listWaiverTemplateHistory(db, shop.id);
    // Newest first, gapless, all the way back to the shop's first release.
    expect(history.map((row) => row.version)).toEqual(
      Array.from({ length: seeded + 1 }, (_, index) => seeded + 1 - index),
    );
  });

  it("gives concurrent saves distinct, gapless versions instead of colliding (CR-015)", async () => {
    const { db, shop, template } = await waiverContext();
    const seeded = template.version;

    const [a, b, c] = await Promise.all([
      saveWaiverTemplate(db, {
        shopId: shop.id,
        title: template.title,
        body: "Concurrent A body.",
      }),
      saveWaiverTemplate(db, {
        shopId: shop.id,
        title: "A different title",
        body: "Concurrent B body.",
      }),
      saveWaiverTemplate(db, {
        shopId: shop.id,
        title: template.title,
        body: "Concurrent C body.",
      }),
    ]);

    const versions = [a.template.version, b.template.version, c.template.version].sort(
      (x, y) => x - y,
    );
    expect(versions).toEqual([seeded + 1, seeded + 2, seeded + 3]);
    const history = await listWaiverTemplateHistory(db, shop.id);
    expect(history.map((row) => row.version)).toEqual(
      Array.from({ length: seeded + 3 }, (_, index) => seeded + 3 - index),
    );
  });

  it("keeps a completed record faithful to the version it was signed against", async () => {
    const { db, person, shop, booking, template } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });

    // Editing the waiver after it was signed must not rewrite the evidence.
    await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially rewritten release that no signed record should adopt.",
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(record?.templateVersion).toBe(template.version);
    expect(record?.templateBody).toBe(template.body);
    expect(record ? verifyWaiverIntegrity(record) : "unsealed").toBe("valid");
  });
});

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

// The Signatures tab's data (task 155, UX persona assessment Lens 17): the
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
    const { db: db2, shop: shop2, booking: booking2, person: person2 } = await waiverContext();
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

describe("staff records a paper / in-person signature", () => {
  async function staffPerson(db: Awaited<ReturnType<typeof waiverContext>>["db"], shopId: string) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("demo staff missing");
    return staff.person;
  }

  it("stores an immutable staff-attested record that clears the waiver gate", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    const before = await getBookingReadiness(db, shop.id, booking.id);
    expect(before?.blockers).toContainEqual(expect.objectContaining({ code: "waiver_not_sent" }));

    const outcome = await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { bookingId: booking.id },
      recordedByPersonId: staff.id,
      medicalAttested: true,
      now,
    });
    expect(outcome).toMatchObject({ ok: true, alreadySigned: false });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, booking.id));
    expect(record).toMatchObject({
      status: "completed",
      signatureMethod: "in_person_attested",
      recordedByPersonId: staff.id,
      personId: booking.personId,
      medicalReviewRequired: false,
    });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "waiver_not_sent" }),
    );
  });

  it("is idempotent — a booking already signed keeps its single record", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });

    const outcome = await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { bookingId: booking.id },
      recordedByPersonId: staff.id,
      medicalAttested: true,
      now,
    });
    expect(outcome).toMatchObject({ ok: true, alreadySigned: true });
    const rows = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, booking.id));
    expect(rows.filter((row) => row.status === "completed")).toHaveLength(1);
  });

  it("retires a live pending link so its token can never complete a second record", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");

    await recordInPersonWaiver(db, {
      shopId: shop.id,
      subject: { bookingId: booking.id },
      recordedByPersonId: staff.id,
      medicalAttested: true,
      now,
    });
    expect(await getWaiverForToken(db, issued.token, now)).toEqual({ state: "unavailable" });
  });

  it("refuses a recorder who is not shop staff, failing closed", async () => {
    const { db, shop, booking } = await waiverContext();
    // The booking's own diver is not staff, and a stranger id is not in the shop.
    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: booking.personId,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    const staff = await staffPerson(db, shop.id);
    expect(
      await recordInPersonWaiver(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses to record a paper waiver without a medical-clear attestation", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: false,
        now,
      }),
    ).toEqual({ ok: false, reason: "medical_attestation_required" });
    // Nothing is written — the booking still needs a waiver.
    const rows = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, booking.id));
    expect(rows).toHaveLength(0);
  });
});

/**
 * Security review of the live-roles work, following 40d0a09's fix to the three
 * roll-call writers in `src/db/manifests.ts`. This writer authorized its
 * attestor with the same hand-rolled `person_roles` join — `people.id` /
 * `people.shopId` / `person_roles.role` — and checked neither
 * `people.deleted_at` nor `user_accounts.status`. So the two cases
 * `loadActiveStaffRoles` exists for both got through:
 *
 * - a **deleted** person, because `deleteDiver` sets `people.deleted_at` and
 *   leaves every role row exactly where it is;
 * - a **disabled** account, because `setStaffAccountStatus` revokes sign-in and
 *   leaves `person_roles` entirely intact — a suspended employee keeps every
 *   role row they had, which is a role row outliving the person's standing by
 *   design rather than by oversight.
 *
 * What each bought is not a read: it is an immutable `waiver_records` row,
 * status `completed`, `signature_method` `in_person_attested`, stamped
 * `recorded_by_person_id`. That row is a signed medical and liability release
 * and the stamp is the shop's answer to "who watched this diver sign?" — a
 * document that may have to stand up outside the company, attributed to
 * somebody the shop had already removed. So the assertion that matters in every
 * test below is not the refusal code, it is that no record exists afterwards.
 *
 * The refusal stays the writer's existing `staff_not_found`: it is the same
 * answer to the same question, and both server actions above it
 * (`markWaiverInPersonAction`, `markWaiverInPersonFromCheckIn`) already fold
 * every non-medical refusal into one `waiver-error` notice.
 */
describe("the in-person attestor must be live staff (defence in depth)", () => {
  async function liveStaff(db: Awaited<ReturnType<typeof waiverContext>>["db"], shopId: string) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("demo staff missing");
    return staff.person;
  }

  /** Every release on file for this booking, whatever its status. */
  async function recordsFor(
    db: Awaited<ReturnType<typeof waiverContext>>["db"],
    bookingId: string,
  ) {
    return db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, bookingId));
  }

  it("refuses a deleted person, and records no release in their name", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await liveStaff(db, shop.id);
    // `deleteDiver`'s soft delete, which touches nothing but this column — the
    // staff roles that authorized them are all still sitting there.
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, staff.id));

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });

    // The outcome that matters. A refusal that still wrote the release would be
    // no fix at all: the row is the document, and it is immutable.
    expect(await recordsFor(db, booking.id)).toEqual([]);
  });

  it("refuses a disabled account still holding a stale role row, and records no release", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await liveStaff(db, shop.id);
    // Access revoked, roster row intact — what `setStaffAccountStatus` leaves
    // behind. Sign-in already refuses this account; until now the writer did not.
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, staff.id));
    // The stale role row is the whole point of the case, so prove it is there
    // rather than assuming it.
    expect(
      await db.select().from(personRoles).where(eq(personRoles.personId, staff.id)),
    ).not.toEqual([]);

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });

    expect(await recordsFor(db, booking.id)).toEqual([]);
  });

  it("still lets live staff attest, and still refuses one demoted to diver", async () => {
    const { db, shop, booking } = await waiverContext();
    const staff = await liveStaff(db, shop.id);
    // The control for both refusals above: same shop, same booking, same call —
    // only the attestor's standing differs.
    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toMatchObject({ ok: true, alreadySigned: false });
    expect(await recordsFor(db, booking.id)).toMatchObject([
      { status: "completed", recordedByPersonId: staff.id },
    ]);

    // Demotion is the case the hand-rolled join did catch, and the rewrite must
    // keep catching it: every staff role gone, a `diver` row left. The gate runs
    // before the idempotency read, so the answer is the refusal rather than the
    // cheerful `alreadySigned` a signed booking would otherwise get.
    await db
      .delete(personRoles)
      .where(and(eq(personRoles.personId, staff.id), inArray(personRoles.role, [...STAFF_ROLES])));
    await db.insert(personRoles).values({ personId: staff.id, role: "diver" });

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    // Still just the one release the live staff member attested.
    expect(await recordsFor(db, booking.id)).toHaveLength(1);
  });

  it("leaves a live pending link signable when it refuses", async () => {
    // Adversarial: the writer retires any live pending link so its bearer token
    // cannot complete a second record. That happens *after* the staff gate, so
    // a refused attestation must leave the diver's own link exactly as it was —
    // a removed staff member must not be able to burn a diver's waiver link
    // just by tapping "signed on paper".
    const { db, shop, booking } = await waiverContext();
    const staff = await liveStaff(db, shop.id);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, staff.id));

    expect(
      await recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { bookingId: booking.id },
        recordedByPersonId: staff.id,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });

    expect(await getWaiverForToken(db, issued.token, now)).toMatchObject({ state: "available" });
    expect((await recordsFor(db, booking.id)).map((row) => row.status)).toEqual(["pending"]);
  });
});

describe("emergency contact captured with the waiver", () => {
  it("writes the diver's emergency contact to their person record on completion", async () => {
    const { db, person, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);

    const outcome = await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      emergencyContact: { name: "Sam Quinn", phone: "+1 305 555 0114" },
      now,
    });
    expect(outcome.ok).toBe(true);

    await expect(getEmergencyContactForBooking(db, booking.id)).resolves.toEqual({
      name: "Sam Quinn",
      phone: "+1 305 555 0114",
    });
  });

  it("never wipes a contact already on file when the diver leaves it blank", async () => {
    const { db, person, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Existing Contact", emergencyContactPhone: "555-0000" })
      .where(eq(people.id, booking.personId));
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);

    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      emergencyContact: { name: "", phone: "" },
      now,
    });

    await expect(getEmergencyContactForBooking(db, booking.id)).resolves.toEqual({
      name: "Existing Contact",
      phone: "555-0000",
    });
  });
});

// The roster's staff-facing capture (task 144) calls `saveBookingEmergencyContact`
// directly rather than through a bearer token, so its shop-scoping is the only
// thing standing between a staffer and another shop's booking — covered here
// rather than only indirectly through `completeWaiver`.
describe("saveBookingEmergencyContact (staff-facing write path, task 144)", () => {
  it("writes a contact for a booking scoped to the given shop", async () => {
    const { db, shop, booking } = await waiverContext();
    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "Alex Rivera",
      phone: "+1 305 555 0133",
    });
    expect(saved).toBe(true);
    await expect(getEmergencyContactForBooking(db, booking.id)).resolves.toEqual({
      name: "Alex Rivera",
      phone: "+1 305 555 0133",
    });
  });

  it("refuses to write when the booking belongs to a different shop", async () => {
    const { db, booking } = await waiverContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-emergency-contact-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    // The seeded demo diver may already carry a contact — capture whatever it
    // actually is rather than assume null, so this asserts nothing changed,
    // not a specific starting value.
    const before = await getEmergencyContactForBooking(db, booking.id);

    const saved = await saveBookingEmergencyContact(db, {
      shopId: otherShop.id,
      bookingId: booking.id,
      name: "Should Not Land",
      phone: "+1 000 000 0000",
    });
    expect(saved).toBe(false);
    await expect(getEmergencyContactForBooking(db, booking.id)).resolves.toEqual(before);
  });

  it("is a no-op when both fields are blank, never wiping what's on file", async () => {
    const { db, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Kept Contact", emergencyContactPhone: "555-0099" })
      .where(eq(people.id, booking.personId));

    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "   ",
      phone: "",
    });
    expect(saved).toBe(false);
    await expect(getEmergencyContactForBooking(db, booking.id)).resolves.toEqual({
      name: "Kept Contact",
      phone: "555-0099",
    });
  });
});

/**
 * Erasure (ADR 20260802-diver-data-erasure) is the one operation that reaches
 * into completed evidence and changes it. These tests are the waiver side of
 * that bargain: what the audit still shows, and what a bearer token can still
 * do, once a diver has been erased.
 */
describe("signed waivers after a diver is erased", () => {
  async function erasedContext(options: { completeIt: boolean }) {
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

/**
 * **Pressing Save must not cost a shop every signature it holds.**
 *
 * `isCompletedWaiverCurrent` reads a signature against an older version as no
 * longer current, so publishing a version invalidates the whole shop's signed
 * releases at once — every booked diver on every forward departure flips to
 * blocked. A staffer who opened the editor to read the release and pressed Save
 * on the way out had done exactly that, and been told "Saved" (issue #720).
 */
describe("saving the waiver template", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");

  async function signedContext() {
    const { db, shop, booking, person, template } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    return { db, shop, template };
  }

  // The demo shop is not a toy fixture here: it carries ~170 signed releases on
  // its current version, which is the ticket's whole point — one tap of Save
  // used to put every one of them back in the queue. So these assert against
  // what the seed actually holds rather than a hand-counted number, and each
  // one first proves the number is non-zero, or "nothing was lost" would pass
  // just as happily against a shop with nothing to lose.

  it("writes no version at all when the body has not changed", async () => {
    const { db, shop, template } = await signedContext();
    const before = await listWaiverTemplateHistory(db, shop.id);
    const standing = await countSignedWaiversOnCurrentVersion(db, shop.id, now);

    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      // Untrimmed on purpose: the editor hands back whatever the textarea
      // holds, and trailing whitespace is not an edit anyone made.
      body: `  ${template.body}  `,
    });

    expect(result.versioned).toBe(false);
    expect(result.template.id).toBe(template.id);
    expect(await listWaiverTemplateHistory(db, shop.id)).toHaveLength(before.length);
    // Every signature it would have invalidated is untouched, which is the
    // whole point — the history length above only proves nothing was inserted.
    expect(standing).toBeGreaterThan(0);
    expect(await countSignedWaiversOnCurrentVersion(db, shop.id, now)).toBe(standing);
  });

  it("versions a real edit, and reports the signatures it just put back in the queue", async () => {
    const { db, shop, template } = await signedContext();
    // Counted before the save, which is the only moment the number exists: the
    // new version is current the instant it lands and nothing is signed
    // against it yet.
    expect(await countSignedWaiversOnCurrentVersion(db, shop.id, now)).toBeGreaterThan(0);

    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially different release, long enough to be valid as a version.",
    });

    expect(result.versioned).toBe(true);
    expect(result.template.version).toBe(template.version + 1);
    expect(await countSignedWaiversOnCurrentVersion(db, shop.id, now)).toBe(0);
  });

  it("does not count a signature the validity window has already aged out", async () => {
    const { db, shop } = await signedContext();
    expect(await countSignedWaiversOnCurrentVersion(db, shop.id, now)).toBeGreaterThan(0);
    // Far enough past every seeded signature's validity window that none of
    // them stand. Those were not going to clear anyone tomorrow either, so
    // publishing a version costs them nothing — and a number a shop can
    // disprove is a number they stop reading.
    const later = new Date(now.getTime() + WAIVER_SIGNATURE_VALIDITY_MS * 3);
    expect(await countSignedWaiversOnCurrentVersion(db, shop.id, later)).toBe(0);
  });

  /**
   * **An edit nobody made must not invalidate every signature a shop holds.**
   *
   * Text pasted back from Word, Pages or an email can arrive Unicode-decomposed
   * — `exención` byte-unequal to the identical-looking stored string, with
   * nothing on screen to distinguish them. A Spanish-language shop is the
   * likeliest victim, and the cost is the entire forward roster blocked
   * (`dive-domain-expert`, after #720 shipped).
   *
   * NFC is *canonical equivalence*, so this is not inferring materiality from a
   * diff: the rendered legal document is the same document.
   */
  it("treats a decomposed paste of the same text as no change at all", async () => {
    const { db, shop } = await signedContext();
    // A Spanish release, because that is where this bites: the seeded English
    // body is pure ASCII, where NFD and NFC are the same bytes and the bug is
    // invisible.
    const spanish =
      "Exención de responsabilidad: reconozco los riesgos del buceo, la inmersión " +
      "y la navegación, y participo de forma voluntaria bajo mi propia decisión médica.";
    await saveWaiverTemplate(db, { shopId: shop.id, body: spanish });
    const before = await listWaiverTemplateHistory(db, shop.id);
    expect(spanish.normalize("NFD")).not.toBe(spanish);

    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: spanish.normalize("NFD"),
    });

    expect(result.versioned).toBe(false);
    expect(await listWaiverTemplateHistory(db, shop.id)).toHaveLength(before.length);
  });

  it("carries the shop's own title forward instead of renaming its release", async () => {
    const { db, shop, template } = await waiverContext();
    // The demo shop calls its release "Blue Mantis Diving Release". The editor
    // has no title field, so a save cannot mean "rename" — but it used to pass
    // the platform default, which silently retitled a shop's legal instrument
    // on its first edit.
    expect(template.title).not.toBe(DEFAULT_WAIVER_TITLE);

    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      body: "An edit that changes the words and must not change the name of the document.",
    });

    expect(result.versioned).toBe(true);
    expect(result.template.title).toBe(template.title);
  });

  it("counts nothing for a shop that has never published a release", async () => {
    const { db } = await waiverContext();
    expect(await countSignedWaiversOnCurrentVersion(db, randomUUID(), now)).toBe(0);
  });
});
