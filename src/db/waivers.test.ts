// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { seededShopContext } from "@/test/db";
import { getBookingReadiness } from "./readiness";
import { people, waiverRecords } from "./schema";
import { getTripRoster, listStaff, setTripStatus, upcomingTripsWithCounts } from "./trips";
import {
  completeWaiver,
  getCurrentWaiverTemplate,
  getEmergencyContactForBooking,
  getWaiverForToken,
  issueWaiverRequest,
  listTripWaiverActivity,
  listWaiverIntegrityAudit,
  listWaiverTemplateHistory,
  recordInPersonWaiver,
  saveWaiverTemplate,
  WAIVER_INTEGRITY_PAGE_SIZE,
} from "./waivers";

const now = new Date("2026-07-18T12:00:00.000Z");
const clearAnswers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

async function waiverContext() {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  if (!trip) throw new Error("demo trip missing");
  const [rosterEntry] = await getTripRoster(db, shop.id, trip.id);
  if (!rosterEntry) throw new Error("demo booking missing");
  const template = await getCurrentWaiverTemplate(db, shop.id);
  if (!template) throw new Error("demo waiver template missing");
  return { db, shop, trip, booking: rosterEntry.booking, template };
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

  it("supersedes a pending link and fails the old bearer token closed", async () => {
    const { db, shop, trip, booking } = await waiverContext();
    const first = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: new Date(now.getTime() + 1),
    });
    if (!first.ok || !second.ok) throw new Error("expected both links to issue");
    expect(await getWaiverForToken(db, first.token, now)).toEqual({ state: "unavailable" });
    expect(await getWaiverForToken(db, second.token, now)).toMatchObject({ state: "available" });
    const activity = await listTripWaiverActivity(db, shop.id, trip.id);
    expect(
      activity
        .filter((row) => row.booking.id === booking.id)
        .flatMap((row) => (row.waiver ? [row.waiver] : [])),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.recordId, supersededAt: expect.any(Date) }),
        expect.objectContaining({ id: second.recordId, supersededAt: null }),
      ]),
    );
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
    expect(newer.version).toBe(2);

    const state = await getWaiverForToken(db, issued.token, now);
    expect(state).toMatchObject({
      state: "available",
      record: { templateVersion: 1, templateBody: template.body },
    });
  });

  it("makes completion idempotent and routes a medical yes to review", async () => {
    const { db, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    const input = {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: { ...clearAnswers, responses: { heart_lung: true } },
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

  it("saves each edit as the next version and points new links at the current one", async () => {
    const { db, shop, template } = await waiverContext();
    expect(template.version).toBe(1);

    const v2 = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "An updated release, edited by staff and long enough to be valid.",
    });
    expect(v2.version).toBe(2);

    // The newest version is always current.
    const currentNow = await getCurrentWaiverTemplate(db, shop.id);
    expect(currentNow?.id).toBe(v2.id);
    const history = await listWaiverTemplateHistory(db, shop.id);
    expect(history.map((row) => row.version)).toEqual([2, 1]);
  });

  it("gives concurrent saves distinct, gapless versions instead of colliding (CR-015)", async () => {
    const { db, shop, template } = await waiverContext();
    expect(template.version).toBe(1);

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

    const versions = [a.version, b.version, c.version].sort((x, y) => x - y);
    expect(versions).toEqual([2, 3, 4]);
    const history = await listWaiverTemplateHistory(db, shop.id);
    expect(history.map((row) => row.version)).toEqual([4, 3, 2, 1]);
  });

  it("keeps a completed record faithful to the version it was signed against", async () => {
    const { db, shop, booking, template } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
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
  it("pages with a keyset cursor and never repeats or skips a record", async () => {
    const { db, shop } = await waiverContext();

    // The demo shop's history is well past WAIVER_INTEGRITY_PAGE_SIZE, so
    // fetch a limit large enough to get every record back as ground truth.
    const all = await listWaiverIntegrityAudit(db, shop.id, { limit: 1000 });
    expect(all.nextCursor).toBeNull();
    expect(all.entries.length).toBeGreaterThan(WAIVER_INTEGRITY_PAGE_SIZE);

    const seen: string[] = [];
    let cursor: string | undefined;
    const maxHops = Math.ceil(all.entries.length / 40) + 1;
    for (let hops = 0; hops < maxHops; hops++) {
      const page = await listWaiverIntegrityAudit(db, shop.id, { cursor, limit: 40 });
      expect(page.entries.length).toBeLessThanOrEqual(40);
      seen.push(...page.entries.map((entry) => entry.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.entries.map((entry) => entry.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("defaults to WAIVER_INTEGRITY_PAGE_SIZE per page and returns a cursor for more", async () => {
    const { db, shop } = await waiverContext();
    const page = await listWaiverIntegrityAudit(db, shop.id);
    expect(page.entries.length).toBe(WAIVER_INTEGRITY_PAGE_SIZE);
    expect(page.nextCursor).not.toBeNull();
  });

  it("treats a mangled cursor as the first page", async () => {
    const { db, shop } = await waiverContext();
    const all = await listWaiverIntegrityAudit(db, shop.id, { limit: 5 });
    const mangled = await listWaiverIntegrityAudit(db, shop.id, {
      cursor: "not-a-real-cursor",
      limit: 5,
    });
    expect(mangled.entries.map((entry) => entry.id)).toEqual(all.entries.map((entry) => entry.id));
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
      bookingId: booking.id,
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
    const { db, shop, booking } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });

    const outcome = await recordInPersonWaiver(db, {
      shopId: shop.id,
      bookingId: booking.id,
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
      bookingId: booking.id,
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
        bookingId: booking.id,
        recordedByPersonId: booking.personId,
        medicalAttested: true,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    const staff = await staffPerson(db, shop.id);
    expect(
      await recordInPersonWaiver(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId: booking.id,
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
        bookingId: booking.id,
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

describe("emergency contact captured with the waiver", () => {
  it("writes the diver's emergency contact to their person record on completion", async () => {
    const { db, shop, booking } = await waiverContext();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);

    const outcome = await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
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
    const { db, shop, booking } = await waiverContext();
    await db
      .update(people)
      .set({ emergencyContactName: "Existing Contact", emergencyContactPhone: "555-0000" })
      .where(eq(people.id, booking.personId));
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);

    await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
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
