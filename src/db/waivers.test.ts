import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANONYMIZED_PERSON_NAME } from "@/lib/anonymization";
import { STAFF_ROLES } from "@/lib/authz";
import { emptyMedicalAnswers, findQuestionnaireVersion, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { operationalWindow } from "@/lib/operational-window";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import {
  DEFAULT_WAIVER_TITLE,
  isCleanCompletion,
  isUnresolvedMedicalHold,
  shopWaiverStatus,
  WAIVER_SIGNATURE_VALIDITY_MS,
  waiverState,
} from "@/lib/waivers";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { getBookingReadiness } from "./readiness";
import {
  bookings,
  people,
  personRoles,
  shops,
  trips,
  userAccounts,
  waiverMaterialityDecisions,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import {
  createTrip,
  getTripRoster,
  listStaff,
  setTripStatus,
  upcomingTripsWithCounts,
} from "./trips";
import { setTripCrew } from "./trips-crew";
import {
  completeWaiver,
  getCurrentWaiverTemplate,
  getEmergencyContactForBooking,
  getMedicalClearanceDocument,
  getSignedWaiverRecordForShop,
  getWaiverForToken,
  hasUnansweredMedicalHold,
  issueWaiverRequest,
  listSignedWaiversByPerson,
  listTripWaiverStatuses,
  listWaiverIntegrityAudit,
  listWaiverTemplateHistory,
  recordInPersonWaiver,
  recordMedicalEvaluation,
  saveBookingEmergencyContact,
  saveWaiverTemplate,
  standingWaiverExposure,
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

  it("never splices a new name onto the contact's old number", async () => {
    const { db, person, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Old Contact", emergencyContactPhone: "555-0000" })
      .where(eq(people.id, booking.personId));
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);

    // The page refuses this shape before it gets here; the writer refuses it
    // again, because a half pair reaching the record is the whole hazard.
    const outcome = await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      emergencyContact: { name: "New Person", phone: "" },
      now,
    });

    expect(outcome.ok).toBe(true);
    await expect(getEmergencyContactForBooking(db, booking.id)).resolves.toEqual({
      name: "Old Contact",
      phone: "555-0000",
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

  // The splice these two refuse is written out over
  // `EmergencyContactSubmission` in `src/lib/contact.ts`. The writer restates
  // the refusal rather than trusting its callers: this is the write a
  // bearer-token page reaches.
  it("writes nothing when a name arrives with the number cleared", async () => {
    const { db, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Old Contact", emergencyContactPhone: "555-0000" })
      .where(eq(people.id, booking.personId));

    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "New Person",
      phone: "   ",
    });

    expect(saved).toBe(false);
    await expect(getEmergencyContactForBooking(db, booking.id)).resolves.toEqual({
      name: "Old Contact",
      phone: "555-0000",
    });
  });

  it("writes nothing when a number arrives with the name cleared", async () => {
    const { db, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Old Contact", emergencyContactPhone: "555-0000" })
      .where(eq(people.id, booking.personId));

    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "",
      phone: "555-0111",
    });

    expect(saved).toBe(false);
    await expect(getEmergencyContactForBooking(db, booking.id)).resolves.toEqual({
      name: "Old Contact",
      phone: "555-0000",
    });
  });

  /**
   * **The tenant is restated on the write, not inherited from the read.** The
   * booking read above it proves the booking is this shop's; nothing in it
   * proves `bookings.person_id` points at a person inside the shop. This is the
   * write a bearer-token page reaches, so the day a row goes wrong that way it
   * has to be non-exploitable rather than merely unlikely.
   */
  it("writes nothing when the booking's person belongs to another shop", async () => {
    const { db, shop, booking } = await waiverContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-cross-tenant-person", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const [stranger] = await db
      .insert(people)
      .values({
        shopId: otherShop.id,
        fullName: "Stranger Diver",
        emergencyContactName: "Their Own Contact",
        emergencyContactPhone: "555-0042",
      })
      .returning();
    if (!stranger) throw new Error("stranger insert failed");
    await db.update(bookings).set({ personId: stranger.id }).where(eq(bookings.id, booking.id));

    const saved = await saveBookingEmergencyContact(db, {
      shopId: shop.id,
      bookingId: booking.id,
      name: "Should Not Land",
      phone: "+1 000 000 0000",
    });

    expect(saved).toBe(false);
    const [after] = await db
      .select({
        name: people.emergencyContactName,
        phone: people.emergencyContactPhone,
      })
      .from(people)
      .where(eq(people.id, stranger.id));
    expect(after).toEqual({ name: "Their Own Contact", phone: "555-0042" });
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
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    return { db, shop, template, staff };
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
    const standing = (await standingWaiverExposure(db, shop.id, now)).divers;

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
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(standing);
  });

  /**
   * Issue #842. A divemaster who signed the shop's release person-scoped counts
   * in `divers` like anyone else, and must never reach `boardingSoon` on the
   * strength of a crew assignment: the release is the customer's, and joining
   * `trip_crew` into that count is the drive-by this pins against. The
   * function's docblock and the glossary's "waiver / release" entry carry the
   * reasoning.
   */
  it("does not count a crew assignment as boarding soon", async () => {
    const { db, shop, staff } = await signedContext();
    const before = await standingWaiverExposure(db, shop.id, now);

    // The signer of `signedContext` is a diver; give a *crew* member a standing
    // signature and a seat on the crew of a departure inside the horizon.
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: staff.person.id,
      now,
    });
    if (!issued.ok) throw new Error(`crew waiver issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.token, {
      signerName: staff.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), gte(trips.startsAt, now)))
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!trip) throw new Error("expected a forward departure");
    await setTripCrew(db, shop.id, trip.id, [staff.person.id]);

    const after = await standingWaiverExposure(db, shop.id, now);
    // The crew member's own signature is exposure, so `divers` moves.
    expect(after.divers).toBe(before.divers + 1);
    // Their crew assignment is not a booking, so the operational number does not.
    expect(after.boardingSoon).toBe(before.boardingSoon);
  });

  it("versions a real edit, and reports the signatures it just put back in the queue", async () => {
    const { db, shop, template } = await signedContext();
    // Counted before the save, which is the only moment the number exists: the
    // new version is current the instant it lands and nothing is signed
    // against it yet.
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBeGreaterThan(0);

    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially different release, long enough to be valid as a version.",
    });

    expect(result.versioned).toBe(true);
    expect(result.template.version).toBe(template.version + 1);
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(0);
  });

  it("keeps signatures current for an explicit non-material correction and records the actor", async () => {
    const { db, shop, template, staff } = await signedContext();
    const standing = (await standingWaiverExposure(db, shop.id, now)).divers;
    expect(standing).toBeGreaterThan(0);
    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A typo-fixed release that keeps the same promises and is long enough to publish.",
      material: false,
      actorPersonId: staff.person.id,
    });
    expect(result.template.version).toBe(template.version + 1);
    expect(result.template.materialGeneration).toBe(template.materialGeneration);
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(standing);
    const [decision] = await db
      .select()
      .from(waiverMaterialityDecisions)
      .where(eq(waiverMaterialityDecisions.templateId, result.template.id));
    expect(decision).toMatchObject({
      shopId: shop.id,
      material: false,
      actorPersonId: staff.person.id,
    });
  });

  it("advances the material generation for an explicit material revision", async () => {
    const { db, shop, template, staff } = await signedContext();
    const result = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially revised release with a changed promise that is long enough to publish.",
      material: true,
      actorPersonId: staff.person.id,
    });
    expect(result.template.materialGeneration).toBe(template.materialGeneration + 1);
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(0);
  });

  it("does not count a signature the validity window has already aged out", async () => {
    const { db, shop } = await signedContext();
    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBeGreaterThan(0);
    // Far enough past every seeded signature's validity window that none of
    // them stand. Those were not going to clear anyone tomorrow either, so
    // publishing a version costs them nothing — and a number a shop can
    // disprove is a number they stop reading.
    const later = new Date(now.getTime() + WAIVER_SIGNATURE_VALIDITY_MS * 3);
    expect((await standingWaiverExposure(db, shop.id, later)).divers).toBe(0);
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
    expect(await standingWaiverExposure(db, randomUUID(), now)).toEqual({
      divers: 0,
      boardingSoon: 0,
    });
  });

  /**
   * **Divers, not records, and only divers who could still sign.**
   *
   * The count was over `waiver_records` while both strings called them divers,
   * and those are different numbers: one diver can hold several standing
   * records on the current version, because `issueWaiverRequest`'s
   * `alreadyStanding` check for a booking subject only looks at records on
   * *that* booking (issue #790).
   */
  it("counts a diver holding two standing records once", async () => {
    const { db, shop } = await signedContext();
    const before = await standingWaiverExposure(db, shop.id, now);
    expect(before.divers).toBeGreaterThan(0);

    // A second completed, non-superseded record on the current version for a
    // diver who already has one — the exact state a staff "Send waiver" on a
    // second seat produces.
    const [existing] = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.status, "completed")))
      .limit(1);
    if (!existing) throw new Error("expected a completed record in the seed");
    await db.insert(waiverRecords).values({
      ...existing,
      id: undefined,
      bookingId: null,
      // `token_hash` is unique — the second link is a second link, which is
      // exactly how this state arises in production.
      tokenHash: `${existing.tokenHash}-second-seat`,
      createdAt: existing.createdAt,
    });

    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(before.divers);
  });

  /**
   * **A deleted diver is still on the boat.**
   *
   * `deleteDiver` is "removal from the active lists, not erasure" and leaves
   * the bookings live; `getTripRoster` and `listTripsWaiverStatuses` both
   * honour that. So a soft-deleted diver holding a live seat is on the
   * manifest, is in the readiness queue, and owes a fresh signature — and a
   * number smaller than the boat is the one direction this must not err
   * (`dive-domain-expert`, on issue #790). A shop merging a duplicate diver
   * mid-season is the ordinary way it happens.
   */
  it("still counts a diver the shop deleted, because their booking is still live", async () => {
    const { db, shop } = await signedContext();
    const before = await standingWaiverExposure(db, shop.id, now);
    expect(before.divers).toBeGreaterThan(0);

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.status, "completed")))
      .limit(1);
    if (!record) throw new Error("expected a completed record in the seed");
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, record.personId));

    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBe(before.divers);
  });

  it("does not count a diver the shop erased, who will never sign anything again", async () => {
    const { db, shop } = await signedContext();
    const before = await standingWaiverExposure(db, shop.id, now);

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.status, "completed")))
      .limit(1);
    if (!record) throw new Error("expected a completed record in the seed");
    // Erasure stamps both columns (`anonymizeDiver`), which is why the query
    // asks only about `anonymized_at`.
    await db
      .update(people)
      .set({ anonymizedAt: now, deletedAt: now })
      .where(eq(people.id, record.personId));

    expect((await standingWaiverExposure(db, shop.id, now)).divers).toBeLessThan(before.divers);
  });

  /**
   * **The operational half.** A three-season shop read "the release that 812
   * divers have signed": accurate, alarming, useless. The number that changes
   * a decision is which boat it lands on this afternoon.
   */
  it("counts only the divers who board inside the operational window as boarding soon", async () => {
    const { db, shop } = await signedContext();
    const exposure = await standingWaiverExposure(db, shop.id, now);

    expect(exposure.divers).toBeGreaterThan(0);
    expect(exposure.boardingSoon).toBeGreaterThan(0);
    // **Strictly fewer**, not merely "no more than". The seeded shop has far
    // more signed divers than it has booked on the next seven days, and the
    // first version of this filter keyed on the *booking* join — which matches
    // any seat on any departure ever — so the two numbers came out equal and
    // the confirm read "127 divers have signed. 127 of them board in the next
    // 7 days." A `<=` assertion passed against exactly that.
    expect(exposure.boardingSoon).toBeLessThan(exposure.divers);
  });

  /**
   * **The window lives on the trip, not the booking.**
   *
   * The first version filtered on `bookings.id is not null` while the horizon
   * sat on a `LEFT JOIN` to `trips` — and a left join cannot eliminate a row
   * from the table on its left, so every diver with any non-cancelled seat on
   * any departure ever was counted as boarding this week. The confirm read
   * "127 divers have signed. 127 of them board in the next 7 days", which is
   * the alarming number restated as an operational one
   * (`dive-domain-expert`, on issue #790).
   *
   * Built explicitly rather than off the seed: two divers, two departures, one
   * inside the horizon and one a day past it.
   */
  it("counts only the diver whose departure falls inside the horizon", async () => {
    const { db, shop, template } = await signedContext();
    const window = operationalWindow(now);

    const sign = async (name: string, startsAt: Date) => {
      const [person] = await db
        .insert(people)
        .values({ shopId: shop.id, fullName: name })
        .returning();
      if (!person) throw new Error("person insert failed");
      const trip = await createTrip(db, {
        shopId: shop.id,
        title: `${name}'s charter`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
        capacity: 8,
        plannedDives: 2,
      });
      if (!trip) throw new Error("trip insert failed");
      const [booking] = await db
        .insert(bookings)
        .values({ shopId: shop.id, tripId: trip.id, personId: person.id, status: "booked" })
        .returning();
      if (!booking) throw new Error("booking insert failed");
      const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
      if (!issued.ok) throw new Error("expected a waiver link");
      await completeWaiver(db, issued.token, {
        signerName: name,
        agreed: true,
        medicalAnswers: clearAnswers,
      });
      return { person, trip };
    };

    const before = await standingWaiverExposure(db, shop.id, now);
    await sign("Inside The Horizon", new Date(window.to.getTime() - 60 * 60 * 1000));
    await sign("Outside The Horizon", new Date(window.to.getTime() + 24 * 60 * 60 * 1000));

    const after = await standingWaiverExposure(db, shop.id, now);
    // Both signed, so both are exposure…
    expect(after.divers).toBe(before.divers + 2);
    // …and exactly one of them boards inside the window.
    expect(after.boardingSoon).toBe(before.boardingSoon + 1);
    void template;
  });

  /**
   * **A called-off Saturday has nobody boarding on it.** `liveTrip()` is only
   * `deleted_at is null`; a blow-out sets `status = 'cancelled'` and leaves the
   * bookings alone until staff work the cascade per seat, so without the status
   * filter a cancelled departure still counted a boatload.
   */
  it("does not count a diver whose departure inside the horizon was cancelled", async () => {
    const { db, shop } = await signedContext();
    const window = operationalWindow(now);
    const startsAt = new Date(window.to.getTime() - 60 * 60 * 1000);

    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Blown Out" })
      .returning();
    if (!person) throw new Error("person insert failed");
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Blown out charter",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!trip) throw new Error("trip insert failed");
    const [booking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, status: "booked" })
      .returning();
    if (!booking) throw new Error("booking insert failed");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: "Blown Out",
      agreed: true,
      medicalAnswers: clearAnswers,
    });

    const sailing = await standingWaiverExposure(db, shop.id, now);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
    const calledOff = await standingWaiverExposure(db, shop.id, now);

    // Still owed a signature — the departure went away, the void one did not.
    expect(calledOff.divers).toBe(sailing.divers);
    // But not boarding this week.
    expect(calledOff.boardingSoon).toBe(sailing.boardingSoon - 1);
  });

  it("counts nobody as boarding soon when no departure falls inside the horizon", async () => {
    const { db, shop } = await signedContext();
    // Ninety days *before* the seeded schedule, so the window [now, now+7d]
    // closes long before the first departure. Moving `now` forward would not
    // do it — the window travels with it and keeps finding departures.
    //
    // The validity check is a lower bound (`signedAt > now - validity`), so
    // every signature still stands from here, which is the half that makes
    // this a test of the horizon rather than of signature ageing.
    const beforeTheSeason = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const early = await standingWaiverExposure(db, shop.id, beforeTheSeason);
    expect(early.divers).toBeGreaterThan(0);
    expect(early.boardingSoon).toBe(0);
  });
});

/**
 * **The one door out of a medical hold** (issue #1252).
 *
 * A referral parks the release in `medical_review` and readiness refuses to
 * board the diver. Before this the only lift was `recordInPersonWaiver`, whose
 * attestation asserts that *no answer needs physician sign-off* — untrue of
 * exactly the diver holding a signed evaluation. These pin that the new act
 * ends the block, that it never manufactures one, and that everything it
 * refuses, it refuses closed.
 */
describe("physician medical clearance", () => {
  /** After the referral was signed (`now`), and not in the future. */
  const EVALUATED_ON = "2026-07-18";

  async function heldContext() {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    });
    const staff = await staffPerson(db, shop.id);
    return { ...context, staff };
  }

  async function staffPerson(db: Awaited<ReturnType<typeof waiverContext>>["db"], shopId: string) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("demo staff missing");
    return staff.person;
  }

  it("ends the medical block and records who cleared it, and when", async () => {
    const { db, shop, booking, staff } = await heldContext();
    const before = await getBookingReadiness(db, shop.id, booking.id);
    expect(before?.blockers).toContainEqual(expect.objectContaining({ code: "medical_review" }));

    const clearedAt = new Date(now.getTime() + 60_000);
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: clearedAt,
    });
    expect(outcome).toMatchObject({ ok: true, alreadyRecorded: false });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record).toMatchObject({
      // The status deliberately does not move: the row still says this diver
      // was referred, and the signed evidence keeps its seal.
      status: "medical_review",
      medicalClearedAt: clearedAt,
      medicalClearedByPersonId: staff.id,
      medicalClearanceDocumentUrl: null,
    });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "medical_review" }),
    );
  });

  it("marks a hold the diver re-signed their way past, with no physician in it", async () => {
    // The hole #1282 is about, through the product's own doors: a referred
    // diver is sent a fresh link, answers "no" to everything, and their standing
    // with the shop reads *current* — no doctor anywhere in it.
    //
    // The booking that carries the referral stays blocked (`effectiveWaiverForBooking`
    // returns a booking's own unresolved hold outright), so the exposure is the
    // diver's **next** seat and the shop-wide standing staff read on the record.
    // That is what this pins, and what now carries the mark.
    const { db, shop, person } = await heldContext();

    const later = new Date(now.getTime() + 3_600_000);
    const again = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: later,
    });
    if (!again.ok) throw new Error("expected a fresh person-scoped link");
    await completeWaiver(db, again.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      now: later,
    });

    const signed = (await listSignedWaiversByPerson(db, shop.id, [person.id])).get(person.id) ?? [];
    const template = await getCurrentWaiverTemplate(db, shop.id);
    const status = shopWaiverStatus({
      personSignedWaivers: signed,
      currentTemplateVersion: template?.materialGeneration ?? null,
      now: later,
    });
    // Cleared — the reproduction, deliberately unchanged. Refusing it would
    // strand a diver who mis-tapped question 3 until a doctor writes a letter,
    // which is its own failure mode and a call for a person to make.
    expect(status.state).toBe("current");
    // And the standing says what it stood over, so the diver's record and the
    // boat's manifest can both say so.
    expect(status).toMatchObject({ medical: { overriddenReferralAt: expect.any(Date) } });
  });

  it("leaves the signed evidence verifiable — a clearance is not a tamper", async () => {
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(verifyWaiverIntegrity(record)).toBe("valid");
  });

  it("stores the physician's evaluation when one is handed over", async () => {
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      documentUrl: "https://media.example.com/medical-clearances/abc.pdf",
      now,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearanceDocumentUrl).toBe(
      "https://media.example.com/medical-clearances/abc.pdf",
    );
  });

  /**
   * **The read path's own query** (issue #1283). #1252 shipped the write
   * before the read: the document went in and nothing ever came out, so a shop
   * bought retention liability with no retrieval value. What this pins is that
   * the reader is shop-scoped in its *own* SQL rather than trusting the route
   * to have checked, and that it refuses the two states where reaching for the
   * bytes would be wrong.
   */
  describe("getMedicalClearanceDocument", () => {
    it("hands back the stored evaluation for a cleared record", async () => {
      const { db, shop, booking, staff } = await heldContext();
      const url = "https://media.example.com/medical-clearances/abc.pdf";
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        documentUrl: url,
        now,
      });
      const [record] = await db
        .select()
        .from(waiverRecords)
        .where(eq(waiverRecords.bookingId, booking.id));

      expect((await getMedicalClearanceDocument(db, shop.id, record.id))?.url).toBe(url);
    });

    it("never reaches another shop's record, on the id alone", async () => {
      // The route scopes by the session's own shop and passes it here; this is
      // the second half of that, in SQL, so a route that one day forgot cannot
      // hand a manager of one shop a diver's medical file from another.
      const { db, shop, booking, staff } = await heldContext();
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        documentUrl: "https://media.example.com/medical-clearances/abc.pdf",
        now,
      });
      const [record] = await db
        .select()
        .from(waiverRecords)
        .where(eq(waiverRecords.bookingId, booking.id));
      const [other] = await db
        .insert(shops)
        .values({
          name: "Rival Reef",
          slug: "rival-reef-clearance-read",
          timezone: "America/New_York",
        })
        .returning();
      if (!other) throw new Error("second shop insert failed");

      expect(await getMedicalClearanceDocument(db, other.id, record.id)).toBeNull();
    });

    it("says nothing for a record still held, and nothing for an erased one", async () => {
      const { db, shop, booking, staff } = await heldContext();
      const [held] = await db
        .select()
        .from(waiverRecords)
        .where(eq(waiverRecords.bookingId, booking.id));
      // Held: no clearance, so by the schema's own check there can be no
      // document either — and asking anyway would read a column the route's
      // claimed state does not cover.
      expect(await getMedicalClearanceDocument(db, shop.id, held.id)).toBeNull();

      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        documentUrl: "https://media.example.com/medical-clearances/abc.pdf",
        now,
      });
      expect(await getMedicalClearanceDocument(db, shop.id, held.id)).not.toBeNull();

      // Erased: `anonymizeDiver` destroys the file and keeps the stamp, so a
      // read through it would be reaching for bytes that are gone.
      await db
        .update(waiverRecords)
        .set({ anonymizedAt: now })
        .where(eq(waiverRecords.id, held.id));
      expect(await getMedicalClearanceDocument(db, shop.id, held.id)).toBeNull();
    });
  });

  it("is idempotent — a second recording never rewrites who cleared it or when", async () => {
    const { db, shop, booking, staff } = await heldContext();
    const first = new Date(now.getTime() + 60_000);
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: first,
    });
    const second = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: new Date(now.getTime() + 120_000),
    });
    expect(second).toMatchObject({ ok: true, alreadyRecorded: true });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearedAt).toEqual(first);
  });

  it("refuses when nothing of this diver's is in review — never a silent success", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "no_medical_hold" });
  });

  it("refuses a recorder who is not this shop's live staff, failing closed", async () => {
    const { db, shop, booking } = await heldContext();
    const [outsider] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Not Staff", email: `outsider-${randomUUID()}@x.test` })
      .returning();
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: outsider.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "staff_not_found" });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers).toContainEqual(expect.objectContaining({ code: "medical_review" }));
  });

  it("never reaches another shop's held record", async () => {
    const { db, booking, staff } = await heldContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other", slug: `other-${randomUUID()}`, timezone: "America/New_York" })
      .returning();
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: otherShop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    // Not even far enough to look at the record: the actor is not that shop's staff.
    expect(outcome).toEqual({ ok: false, reason: "staff_not_found" });
  });

  it("refuses a clearance with nothing behind it — a button press is not evidence", async () => {
    const { db, shop, booking, staff } = await heldContext();
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        now,
      }),
    ).toEqual({ ok: false, reason: "evidence_required" });
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: "",
        physicianName: "Dr. Imani Reyes",
        now,
      }),
    ).toEqual({ ok: false, reason: "evaluation_date_required" });
  });

  it("refuses an evaluation that predates the answers it would clear", async () => {
    // A letter written in March cannot clear a stent placed in June. The
    // referral here was signed on 2026-07-18.
    const { db, shop, booking, staff } = await heldContext();
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: "2026-03-01",
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "evaluation_predates_disclosure" });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers).toContainEqual(expect.objectContaining({ code: "medical_review" }));
  });

  it("refuses an evaluation dated after today — that is a typo, not a clearance", async () => {
    const { db, shop, booking, staff } = await heldContext();
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: "2027-01-01",
        physicianName: "Dr. Imani Reyes",
        now,
      }),
    ).toEqual({ ok: false, reason: "evaluation_in_future" });
  });

  it("never clears a diver in another shop, even for that shop's own live staff", async () => {
    // The sibling test below stops at `staff_not_found`, which is honest but
    // proves nothing about the query's own shop condition. This one gets a real
    // live staff member of shop B past that gate and still finds nothing.
    const { db, shop, booking } = await heldContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other", slug: `other-${randomUUID()}`, timezone: "America/New_York" })
      .returning();
    const [otherStaff] = await db
      .insert(people)
      .values({
        shopId: otherShop.id,
        fullName: "Other Owner",
        email: `other-owner-${randomUUID()}@x.test`,
      })
      .returning();
    await db.insert(personRoles).values({ personId: otherStaff.id, role: "owner" });
    await db.insert(userAccounts).values({
      personId: otherStaff.id,
      email: `other-owner-${randomUUID()}@x.test`,
      hashedPassword: "x",
      status: "active",
    });

    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: otherShop.id,
      personId: booking.personId,
      recordedByPersonId: otherStaff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "no_medical_hold" });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers).toContainEqual(expect.objectContaining({ code: "medical_review" }));
  });

  it("records a refusal without lifting the block, and says the answer arrived", async () => {
    // The whole point of issue #1283: before this, a diver whose physician said
    // no was indistinguishable from one nobody had heard from, so the shop kept
    // chasing and the crew never learned the answer.
    const { db, shop, booking, staff } = await heldContext();
    const declinedAt = new Date(now.getTime() + 60_000);
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: declinedAt,
    });
    expect(outcome).toMatchObject({ ok: true, outcome: "not_cleared", alreadyRecorded: false });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record).toMatchObject({
      status: "medical_review",
      // The safety property, pinned: nothing a refusal writes may read as a
      // clearance to the consumers that key off `medicalClearedAt`.
      medicalClearedAt: null,
      medicalClearedByPersonId: null,
      medicalClearanceDeclinedAt: declinedAt,
      medicalClearanceDeclinedByPersonId: staff.id,
      medicalClearanceEvaluatedOn: EVALUATED_ON,
    });
    expect(isUnresolvedMedicalHold(record)).toBe(true);
    expect(isCleanCompletion(record)).toBe(false);
    expect(waiverState(record, declinedAt)).toBe("medical_not_cleared");

    // Fail-closed end to end: readiness still refuses to board them, and the
    // blocker it raises is the one that says why.
    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers).toContainEqual(
      expect.objectContaining({ code: "medical_not_cleared" }),
    );
    expect(after?.blockers).not.toContainEqual(expect.objectContaining({ code: "medical_review" }));
  });

  it("refuses a clearance on a record a physician already refused, in both directions", async () => {
    // A recorded "no" is not erasable from the desk. A diver re-evaluated after
    // a refusal is answering a fresh disclosure, which signs a new release.
    const { db, shop, booking, staff } = await heldContext();
    const base = {
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
    };
    await recordMedicalEvaluation(db, { ...base, outcome: "not_cleared", now });
    expect(
      await recordMedicalEvaluation(db, {
        ...base,
        outcome: "cleared",
        now: new Date(now.getTime() + 60_000),
      }),
    ).toEqual({ ok: false, reason: "answer_already_recorded" });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearedAt).toBeNull();
    expect(record.medicalClearanceDeclinedAt).not.toBeNull();
  });

  it("refuses a refusal on a record a physician already cleared", async () => {
    // The same rule read the other way, so neither answer is the one that can
    // be quietly overwritten.
    const { db, shop, booking, staff } = await heldContext();
    const base = {
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
    };
    await recordMedicalEvaluation(db, { ...base, outcome: "cleared", now });
    expect(
      await recordMedicalEvaluation(db, {
        ...base,
        outcome: "not_cleared",
        now: new Date(now.getTime() + 60_000),
      }),
    ).toEqual({ ok: false, reason: "answer_already_recorded" });
  });

  it("is idempotent on a repeated refusal, and never rewrites who recorded it", async () => {
    const { db, shop, booking, staff } = await heldContext();
    const base = {
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      outcome: "not_cleared",
    } as const;
    const first = new Date(now.getTime() + 60_000);
    await recordMedicalEvaluation(db, { ...base, now: first });
    expect(
      await recordMedicalEvaluation(db, { ...base, now: new Date(now.getTime() + 120_000) }),
    ).toMatchObject({ ok: true, outcome: "not_cleared", alreadyRecorded: true });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearanceDeclinedAt).toEqual(first);
  });

  it("applies a refusal the same evidence rules as a clearance", async () => {
    // Same act, same evidence: the refusal is the record of why somebody stayed
    // ashore, so it may not be the cheaper one to write.
    const { db, shop, booking, staff } = await heldContext();
    const base = {
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      outcome: "not_cleared",
      now,
    } as const;
    expect(await recordMedicalEvaluation(db, { ...base, evaluatedOn: EVALUATED_ON })).toEqual({
      ok: false,
      reason: "evidence_required",
    });
    expect(
      await recordMedicalEvaluation(db, { ...base, evaluatedOn: "", physicianName: "Dr. Reyes" }),
    ).toEqual({ ok: false, reason: "evaluation_date_required" });
    expect(
      await recordMedicalEvaluation(db, {
        ...base,
        evaluatedOn: "2026-01-01",
        physicianName: "Dr. Reyes",
      }),
    ).toEqual({ ok: false, reason: "evaluation_predates_disclosure" });
  });

  it("hands back the refused evaluation itself, which a claims reader asks for first", async () => {
    // The document read was narrowed to clearances when it shipped. A refusal's
    // own letter is the one an insurer wants, and storing it with no way back
    // to it is the shape issue #1283 exists to close.
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      documentUrl: "https://media.example.com/medical-clearances/refused.pdf",
      now,
    });
    const [held] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(await getMedicalClearanceDocument(db, shop.id, held.id)).toEqual({
      url: "https://media.example.com/medical-clearances/refused.pdf",
      personId: booking.personId,
    });
  });

  it("stops asking for an answer once a refusal has arrived", async () => {
    // `hasUnansweredMedicalHold` and `isUnresolvedMedicalHold` deliberately
    // disagree here, and this is the pair that proves it: no answer is
    // outstanding, and the diver is still blocked.
    const { db, shop, booking, staff } = await heldContext();
    expect(await hasUnansweredMedicalHold(db, shop.id, booking.personId)).toBe(true);
    await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(await hasUnansweredMedicalHold(db, shop.id, booking.personId)).toBe(false);
    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.status).toBe("blocked");
  });

  it("erases a refused evaluation the way it erases a cleared one", async () => {
    // The erasure exemption on `..._evidenced` was written for a clearance
    // evidenced only by a document; a refusal reaches the same clause and would
    // otherwise take the whole erasure transaction down with it.
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      documentUrl: "https://media.example.com/medical-clearances/refused.pdf",
      now,
    });
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: staff.id,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearanceDocumentUrl).toBeNull();
    // The shop's own act survives the erasure, as a clearance's does.
    expect(record.medicalClearanceDeclinedAt).not.toBeNull();
    expect(record.medicalClearanceDeclinedByPersonId).toBe(staff.id);
  });

  it("answers the cheap pre-read the surface runs before it stores an evaluation", async () => {
    // The upload happens only when this says yes, so that a staffer who opens
    // the wrong diver's record never puts a real physician's evaluation into
    // the bucket with no row pointing at it (security review H2).
    const { db, shop, booking, staff } = await heldContext();
    expect(await hasUnansweredMedicalHold(db, shop.id, booking.personId)).toBe(true);
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(await hasUnansweredMedicalHold(db, shop.id, booking.personId)).toBe(false);
  });

  it("walks a refused diver back to boardable through a new seat, and only through one", async () => {
    // The sentence the desk reads after a refusal now names this walk, so the
    // walk is a test rather than a claim. The person-level release is the
    // locked door it must never point at: a refusal is an unresolved hold, and
    // `issueWaiverRequest` answers `already_completed` to a record-level ask
    // forever after.
    const { db, shop, booking, person, staff } = await heldContext();
    const refusedAt = new Date(now.getTime() + 60_000);
    await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: refusedAt,
    });

    const [refused] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(isUnresolvedMedicalHold(refused)).toBe(true);
    expect((await getBookingReadiness(db, shop.id, booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "medical_not_cleared" }),
    );

    // The locked door the sentence must not point at: nothing can be sent
    // against the seat that was refused. The record page offers no send at all
    // for a held release (`divers/[personId]/_lib/status.ts`), and the writer
    // agrees — this booking already carries a record that is not pending.
    const later = new Date(now.getTime() + 120_000);
    expect(
      await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now: later }),
    ).toEqual({ ok: false, reason: "already_completed" });

    const startsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextTrip = await createTrip(db, {
      shopId: shop.id,
      title: "Re-evaluated reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!nextTrip) throw new Error("trip insert failed");
    const [nextBooking] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: nextTrip.id, personId: person.id, status: "booked" })
      .returning();
    if (!nextBooking) throw new Error("booking insert failed");
    expect((await getBookingReadiness(db, shop.id, nextBooking.id))?.status).toBe("blocked");

    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: nextBooking.id,
      now: later,
    });
    if (!issued.ok) throw new Error(`the new seat's release was refused: ${issued.reason}`);
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now: later,
    });
    const boarded = await getBookingReadiness(db, shop.id, nextBooking.id);
    expect(boarded?.status).toBe("ready");
    expect(boarded?.blockers).toEqual([]);

    // The refusal is history, not something the new release erased or amended.
    const [stillRefused] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, refused.id));
    expect(stillRefused.medicalClearedAt).toBeNull();
    expect(stillRefused.medicalClearanceDeclinedAt).toEqual(refusedAt);
    expect((await getBookingReadiness(db, shop.id, booking.id))?.status).toBe("blocked");
  });

  it("destroys the physician's evaluation when the diver is erased, and keeps the fact", async () => {
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      documentUrl: "https://media.example.com/medical-clearances/abc.pdf",
      now,
    });
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: staff.id,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearanceDocumentUrl).toBeNull();
    // The shop's own act survives, as the certification sighting does.
    expect(record.medicalClearedAt).not.toBeNull();
    expect(record.medicalClearedByPersonId).toBe(staff.id);
  });
});

/**
 * **A minor's release is signed twice** (ADR 20260907-guardian-co-signature).
 *
 * Safety-critical and adversarial by nature: the whole point of a second signer
 * is that they are somebody else, so the cases that matter are the ones where a
 * twelve-year-old tries to be both. The pure rule lives in `src/lib/guardian.ts`
 * and is tested there; what is pinned here is what the *writers* do with it —
 * refuse before touching the record, write all six columns inside the seal, and
 * decline to treat a solo minor signature as a release that already stands.
 */
describe("the guardian co-signature (ADR 20260907-guardian-co-signature)", () => {
  /** Twelve years old on the demo shop's calendar day at `now`. */
  const MINOR_DOB = "2014-05-01";

  const guardian = {
    name: "Jonas Fischer",
    relationship: "parent",
    email: "Jonas@Example.com ",
    agreed: true,
  };

  /** Put a date of birth on the seat's diver, which is what turns the rule on. */
  async function makeMinor(
    db: Awaited<ReturnType<typeof waiverContext>>["db"],
    personId: string,
    dateOfBirth = MINOR_DOB,
  ) {
    await db.update(people).set({ dateOfBirth }).where(eq(people.id, personId));
  }

  async function liveLink(ctx: Awaited<ReturnType<typeof waiverContext>>) {
    const issued = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
      now,
    });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    return issued;
  }

  it("refuses a minor signing alone, and leaves the link signable", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toEqual({ ok: false, reason: "guardian_required" });

    // A family that missed the section keeps the link they were sent.
    expect(await getWaiverForToken(ctx.db, issued.token, now)).toMatchObject({
      state: "available",
    });
  });

  /**
   * **A father and son of the same legal name.** The refusal above exists to
   * stop a minor signing as their own guardian, so it must not be relaxed — but
   * a real family has to be able to get through, and the error used to name no
   * way out at all. It now names three, and this is what makes them true.
   *
   * The first two are the honest ones: another parent signs, or the parent
   * writes more of his *own* name. Both leave the release naming the adult who
   * actually assumed the risk, which is the whole evidentiary point of the
   * printed guardian name.
   *
   * The copy says a middle name **in full** because a middle *initial* does not
   * escape the refusal: `significantNameTokens` drops tokens shorter than two
   * characters, so "John Q. Smith" and "John Smith" are the same two tokens.
   * Advice that said only "add your middle name" would fail the exact parent
   * who followed it (dive-domain review, 2026-09-08).
   */
  it("lets a same-named family through by the routes the error names", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    await ctx.db.update(people).set({ fullName: "John Smith" }).where(eq(people.id, ctx.person.id));

    // A middle initial is dropped, so this is still the diver's own name.
    const initial = await liveLink(ctx);
    expect(
      await completeWaiver(ctx.db, initial.token, {
        signerName: "John Smith",
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian: { ...guardian, name: "John Q. Smith" },
        now,
      }),
    ).toEqual({ ok: false, reason: "guardian_invalid" });

    // The other parent: the cheapest way through, and the one the error now
    // offers first. Nothing has to be typed differently from the truth.
    expect(
      await completeWaiver(ctx.db, initial.token, {
        signerName: "John Smith",
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian: { ...guardian, name: "Mary Smith" },
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });

    const [byOtherParent] = await db_record(ctx, initial.recordId);
    expect(byOtherParent).toMatchObject({ guardianName: "Mary Smith" });
  });

  /**
   * The same-named parent signing alone, with his middle name written out.
   *
   * A separate seat because the route above already completed that waiver, and
   * because this is the case that decides what ends up printed on a minor's
   * release: the father's own fuller name, never a suffix. Told to "add a
   * suffix like Jr." a father writes **his son's** legal name, and a reader
   * opening the file later sees a release where diver and co-signer are the
   * same person — the exact thing the refusal exists to prevent (dive-domain
   * review, 2026-09-08). The copy does not offer that, and neither does this.
   */
  it("accepts a same-named parent who writes his middle name in full", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    await ctx.db.update(people).set({ fullName: "John Smith" }).where(eq(people.id, ctx.person.id));
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: "John Smith",
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian: { ...guardian, name: "John Michael Smith" },
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });

    const [record] = await db_record(ctx, issued.recordId);
    expect(record).toMatchObject({ guardianName: "John Michael Smith" });
  });

  it("refuses a guardian section that is not a signature", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);

    for (const bad of [
      // The diver typing their own name twice: one signature in two hats, and
      // the single case a browser's `required` attributes cannot catch.
      { ...guardian, name: ctx.person.fullName },
      // A relationship this product does not have a word for.
      { ...guardian, relationship: "uncle" },
      // Blank is now accepted (issue #1453) but a *typed* address that is not
      // one is still a refusal, never a silent null: the page dropped
      // `required`, so this writer-side shape check is the enforcement of
      // record for anything a hand-built request sends.
      { ...guardian, email: "not-an-address" },
      { ...guardian, email: "  parent@ " },
      // A typed name is not a signature until the guardian's own box is ticked.
      { ...guardian, agreed: false },
    ]) {
      const issued = await liveLink(ctx);
      expect(
        await completeWaiver(ctx.db, issued.token, {
          signerName: ctx.person.fullName,
          agreed: true,
          medicalAnswers: clearAnswers,
          guardian: bad,
          now,
        }),
      ).toEqual({ ok: false, reason: "guardian_invalid" });
      expect(await getWaiverForToken(ctx.db, issued.token, now)).toMatchObject({
        state: "available",
      });
    }
  });

  /**
   * **The family with no address** (issue #1453, owner decision 2026-09-10:
   * "send a copy where there is an address, and stop refusing a family that
   * has none").
   *
   * A grandparent at a counter with no email, or a household sharing the one
   * the diver already gave, was refused outright — while the column they were
   * being made to fill had no reader at all. It is optional now, stored null,
   * and the release is a release.
   */
  it("records a co-signature with no guardian address, and seals it", async () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian: { ...guardian, email: "" },
        now,
      }),
    ).toMatchObject({ ok: true });

    const [record] = await db_record(ctx, issued.recordId);
    expect(record).toMatchObject({
      guardianName: "Jonas Fischer",
      guardianRelationship: "parent",
      guardianEmail: null,
      guardianSignatureMethod: "typed_consent",
    });
    if (!record) throw new Error("expected a record row");
    expect(verifyWaiverIntegrity(record)).toBe("valid");
    // The boarding gate is cleared by the signature, never by the address.
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.booking.id);
    expect(readiness?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "guardian_signature_missing" }),
    );
  });

  it("writes the co-signature, seals it, and clears the boarding gate", async () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        guardian,
        now,
      }),
    ).toMatchObject({ ok: true, status: "completed" });

    const [record] = await db_record(ctx, issued.recordId);
    expect(record).toMatchObject({
      guardianName: "Jonas Fischer",
      guardianRelationship: "parent",
      // Trimmed and lower-cased, like every other address the product stores.
      guardianEmail: "jonas@example.com",
      guardianSignatureMethod: "typed_consent",
    });
    expect(record?.guardianSignedAt).not.toBeNull();
    expect(record?.guardianConsentedAt).not.toBeNull();
    // The draft of the section goes with the rest of the unsubmitted state.
    expect(record?.draftGuardian).toBeNull();
    expect(verifyWaiverIntegrity(record)).toBe("valid");

    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.booking.id);
    expect(readiness?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "guardian_signature_missing" }),
    );
  });

  /**
   * The backfill case, and the one a shop will actually meet: the release was
   * signed before anyone asked the diver's age, and the date of birth lands
   * afterwards. The standing signature becomes a blocker rather than a silent
   * pass, and the ordinary "send the waiver" tap mints a fresh link instead of
   * answering "already signed".
   */
  it("turns a release signed before the date of birth landed into a blocker, and re-issues over it", async () => {
    const ctx = await waiverContext();
    const issued = await liveLink(ctx);
    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now,
      }),
    ).toMatchObject({ ok: true });

    // Before the date of birth: an ordinary signed release, and no second link.
    expect(
      await issueWaiverRequest(ctx.db, { shopId: ctx.shop.id, bookingId: ctx.booking.id, now }),
    ).toEqual({ ok: false, reason: "already_completed" });

    await makeMinor(ctx.db, ctx.person.id);

    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.booking.id);
    expect(readiness?.blockers).toContainEqual(
      expect.objectContaining({ code: "guardian_signature_missing" }),
    );
    const reissued = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
      now,
    });
    expect(reissued.ok).toBe(true);
  });

  /**
   * The two edits a front desk is told to try when a father and son share a
   * name. `personNamesMatch` compares tokens of two characters or more, so the
   * initial changes nothing and the spelled-out name changes everything —
   * stated here as fixtures rather than in prose, because the notice's advice
   * is only worth giving if it is true.
   */
  const withMiddleInitial = (name: string) => {
    const [first, ...rest] = name.split(" ");
    return [first, "A", ...rest].join(" ");
  };
  const withMiddleName = (name: string) => {
    const [first, ...rest] = name.split(" ");
    return [first, "Aurelio", ...rest].join(" ");
  };

  it("holds the paper path to the same rule, and records the staffer's attestation of it", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    const attempt = (guardianInput?: {
      name: string;
      relationship: string;
      namesakeAttested?: boolean;
    }) =>
      recordInPersonWaiver(ctx.db, {
        shopId: ctx.shop.id,
        subject: { bookingId: ctx.booking.id },
        recordedByPersonId: staff.person.id,
        medicalAttested: true,
        guardian: guardianInput,
        now,
      });

    expect(await attempt()).toEqual({ ok: false, reason: "guardian_required" });
    // **The three refusals are not one refusal** (issue 1539). These two keep
    // the generic notice: retyping fixes the first, and the second cannot come
    // from the form at all, whose `<select>` offers only the two codes.
    //
    // `"J "` rather than whitespace: `paperGuardianFrom` drops a blank name, so
    // that lands on `guardian_required` above and no surface can produce it
    // here. This one can — the browser counts `minLength` on the raw value and
    // `inPersonAttestationProvider.capture` trims first.
    expect(await attempt({ name: "J ", relationship: "parent" })).toEqual({
      ok: false,
      reason: "guardian_invalid",
    });
    expect(await attempt({ name: "Jonas Fischer", relationship: "uncle" })).toEqual({
      ok: false,
      reason: "guardian_invalid",
    });
    // This one the form produces from an honest submission: a family who share
    // a legal name. It keeps its own reason so the staffer who typed it can be
    // told what to do, since "try again" cannot work.
    expect(await attempt({ name: ctx.person.fullName, relationship: "parent" })).toEqual({
      ok: false,
      reason: "guardian_name_matches_diver",
    });
    // **The refusal is still the default** (issue #1573). A namesake co-signer
    // with `namesakeAttested` left off — which is every form the staffer has
    // not ticked, and every request that never rendered the confirmation —
    // meets exactly the refusal it met before.
    expect(
      await attempt({
        name: ctx.person.fullName,
        relationship: "parent",
        namesakeAttested: false,
      }),
    ).toEqual({ ok: false, reason: "guardian_name_matches_diver" });
    expect(
      await attempt({ name: withMiddleInitial(ctx.person.fullName), relationship: "parent" }),
    ).toEqual({ ok: false, reason: "guardian_name_matches_diver" });
    // Nothing was written by either refusal: the row is the document.
    expect(
      await ctx.db.select().from(waiverRecords).where(eq(waiverRecords.bookingId, ctx.booking.id)),
    ).toEqual([]);

    const recorded = await attempt({ name: "Jonas Fischer", relationship: "legal_guardian" });
    if (!recorded.ok) throw new Error(`expected a record: ${recorded.reason}`);
    const [record] = await db_record(ctx, recorded.recordId);
    expect(record).toMatchObject({
      signatureMethod: "in_person_attested",
      guardianName: "Jonas Fischer",
      guardianRelationship: "legal_guardian",
      guardianSignatureMethod: "in_person_attested",
      // No address on a paper form; the diver's own contact is how the shop
      // reaches the family.
      guardianEmail: null,
    });
  });

  /**
   * **The notice's advice, made true** (issue 1539). The staff notice tells a
   * front desk that a spelled-out middle name clears the refusal and a single
   * initial does not, which is only worth saying if `personNamesMatch` behaves
   * that way: it compares tokens of two characters or more, so the initial is
   * dropped and changes nothing. The refusal above pins the initial; this pins
   * the other half, on its own booking because it records a real release.
   */
  it("clears the same refusal once the guardian's middle name is spelled out", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    const recorded = await recordInPersonWaiver(ctx.db, {
      shopId: ctx.shop.id,
      subject: { bookingId: ctx.booking.id },
      recordedByPersonId: staff.person.id,
      medicalAttested: true,
      guardian: { name: withMiddleName(ctx.person.fullName), relationship: "parent" },
      now,
    });

    if (!recorded.ok) throw new Error(`expected a record: ${recorded.reason}`);
    const [record] = await db_record(ctx, recorded.recordId);
    expect(record).toMatchObject({ guardianName: withMiddleName(ctx.person.fullName) });
  });

  /**
   * **The one way past the namesake refusal, and the three fences around it**
   * (issue #1573, owner decision 2026-09-10; ADR 20260907-guardian-co-signature,
   * decision 10).
   *
   * A parent and child whose IDs read identically had no route to a recorded
   * release anywhere in the product. The paper path now has one, because there
   * a named staffer physically watched two people sign — and the assertion
   * lands on the record as its own signature method rather than disappearing
   * into an ordinary attestation.
   */
  it("records a namesake co-signature on the staffer's explicit attestation", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    const recorded = await recordInPersonWaiver(ctx.db, {
      shopId: ctx.shop.id,
      subject: { bookingId: ctx.booking.id },
      recordedByPersonId: staff.person.id,
      medicalAttested: true,
      guardian: {
        name: ctx.person.fullName,
        relationship: "parent",
        namesakeAttested: true,
      },
      now,
    });

    if (!recorded.ok) throw new Error(`expected a record: ${recorded.reason}`);
    const [record] = await db_record(ctx, recorded.recordId);
    expect(record).toMatchObject({
      // The diver's own signature is an ordinary attestation; only the
      // guardian's half carries the distinction, because only it was refused.
      signatureMethod: "in_person_attested",
      guardianName: ctx.person.fullName,
      guardianRelationship: "parent",
      guardianSignatureMethod: "in_person_attested_namesake",
      guardianEmail: null,
    });
    // The staffer who made the assertion is on the row, which is what the
    // assertion is worth anything for.
    expect(record?.recordedByPersonId).toBe(staff.person.id);
    // Inside the seal: a distinction that could be edited off the row after
    // the fact would be no distinction at all.
    if (!record) throw new Error("expected a record row");
    expect(verifyWaiverIntegrity(record)).toBe("valid");

    // **Readiness does not branch on it.** A namesake record is a co-signed
    // record, so the minor boards — which is the entire point of the decision,
    // and the property a future refactor is most likely to break.
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.booking.id);
    expect(readiness?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "guardian_signature_missing" }),
    );
  });

  it("ignores the namesake attestation when the two names differ", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    // A tick on a form whose names are plainly different asserts nothing, so
    // it records nothing: the method stays the ordinary one. Without this the
    // confirmation would become a habitual tick that quietly relabels every
    // paper co-signature.
    const recorded = await recordInPersonWaiver(ctx.db, {
      shopId: ctx.shop.id,
      subject: { bookingId: ctx.booking.id },
      recordedByPersonId: staff.person.id,
      medicalAttested: true,
      guardian: { name: "Jonas Fischer", relationship: "parent", namesakeAttested: true },
      now,
    });

    if (!recorded.ok) throw new Error(`expected a record: ${recorded.reason}`);
    const [record] = await db_record(ctx, recorded.recordId);
    expect(record).toMatchObject({
      guardianName: "Jonas Fischer",
      guardianSignatureMethod: "in_person_attested",
    });
  });

  /**
   * **Adversarial: the online path gains nothing.** The decision is explicit
   * that the browser-facing release keeps refusing a co-signer with the
   * diver's own name — online the shop has no evidence a second person exists
   * at all. `GuardianInput` carries no attestation field, so a hand-built
   * request cannot even name one; this pins that a stray property on the
   * submitted object changes nothing about the answer.
   */
  it("keeps refusing a namesake guardian on the online path, attestation or not", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);

    expect(
      await completeWaiver(ctx.db, issued.token, {
        signerName: ctx.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        // Spread through `unknown`: `namesakeAttested` is not part of
        // `GuardianInput` and the compiler is right to say so — a hand-built
        // request is not type-checked, which is exactly what this is standing
        // in for.
        guardian: {
          ...guardian,
          name: ctx.person.fullName,
          namesakeAttested: true,
        } as unknown as typeof guardian,
        now,
      }),
    ).toEqual({ ok: false, reason: "guardian_invalid" });

    // Nothing was written, and the link is still the one the family holds.
    expect(await getWaiverForToken(ctx.db, issued.token, now)).toMatchObject({
      state: "available",
    });
  });

  it("takes the guardian's name and address under erasure and keeps the signature's fact", async () => {
    const ctx = await waiverContext();
    await makeMinor(ctx.db, ctx.person.id);
    const issued = await liveLink(ctx);
    await completeWaiver(ctx.db, issued.token, {
      signerName: ctx.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      guardian,
      now,
    });
    const [staff] = await listStaff(ctx.db, ctx.shop.id);
    if (!staff) throw new Error("demo staff missing");

    const erased = await anonymizeDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId: ctx.person.id,
      actorPersonId: staff.person.id,
    });
    expect(erased.ok).toBe(true);

    const [record] = await db_record(ctx, issued.recordId);
    // A third party's personal data goes with the diver's own...
    expect(record?.guardianName).toBeNull();
    expect(record?.guardianEmail).toBeNull();
    // ...and the fact that somebody co-signed, as what and when, survives —
    // exactly as the diver's own `signed_at` does.
    expect(record?.guardianRelationship).toBe("parent");
    expect(record?.guardianSignedAt).not.toBeNull();
    expect(record?.guardianSignatureMethod).toBe("typed_consent");
  });

  /** One release row by id, for the assertions above. */
  function db_record(ctx: Awaited<ReturnType<typeof waiverContext>>, recordId: string) {
    return ctx.db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
  }
});

describe("listTripWaiverStatuses row order (issue #1753)", () => {
  /**
   * **The two readers of one roster answer in the same order.**
   *
   * `getTripRoster` and `listTripsWaiverStatuses` walk the same seats with the
   * same filter, and this one used to stop at `asc(bookings.id)` — a
   * `defaultRandom()` uuid — while the roster had moved on to
   * `asc(people.full_name)`. Nothing renders this array directly today (every
   * consumer re-keys it by booking id), so the cost was not a visible list: it
   * was that the documented order was unpredictable, and that whoever next
   * rendered these rows would have got a different order from the manifest
   * beside it.
   *
   * The tie is forced with `created_at`, and the **higher** uuid is given to
   * the diver who must sort first, so the old clause answered the exact
   * opposite every time rather than half the time.
   */
  it("breaks a shared-instant tie on the diver's name, and agrees with getTripRoster", async () => {
    const { db, shop } = await seededShopContext();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Waiver Order Reef",
      startsAt: new Date("2026-08-02T13:00:00.000Z"),
      endsAt: new Date("2026-08-02T17:00:00.000Z"),
      capacity: 12,
      plannedDives: 2,
    });
    if (!trip) throw new Error("test trip insert failed");
    const together = new Date("2026-07-21T13:30:00.000Z");
    const seat = async (fullName: string, id: string) => {
      const [person] = await db.insert(people).values({ shopId: shop.id, fullName }).returning();
      if (!person) throw new Error("test person insert failed");
      await db
        .insert(bookings)
        .values({ id, shopId: shop.id, tripId: trip.id, personId: person.id, createdAt: together });
    };
    // "Alpha Nord" must come first, so it gets the higher uuid.
    await seat("Zulu Mbeki", "00000000-0000-4000-8000-000000000001");
    await seat("Alpha Nord", "00000000-0000-4000-8000-000000000002");

    const statuses = await listTripWaiverStatuses(db, shop.id, trip.id);
    expect(statuses.map((row) => row.person.fullName)).toEqual(["Alpha Nord", "Zulu Mbeki"]);
    // …and the roster it sits beside gives the identical order.
    const roster = await getTripRoster(db, shop.id, trip.id);
    expect(statuses.map((row) => row.booking.id)).toEqual(roster.map((row) => row.booking.id));
  });
});
