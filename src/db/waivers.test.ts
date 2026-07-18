// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { getShopBySlug, getTripRoster, setTripStatus, upcomingTripsWithCounts } from "./queries";
import { waiverRecords } from "./schema";
import { seedDemo } from "./seed";
import {
  completeWaiver,
  createWaiverTemplate,
  getWaiverForToken,
  issueWaiverRequest,
  listTripWaiverActivity,
  listWaiverTemplates,
  setDefaultWaiverTemplate,
} from "./waivers";

const now = new Date("2026-07-18T12:00:00.000Z");
const clearAnswers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

async function waiverContext() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  if (!trip) throw new Error("demo trip missing");
  const [rosterEntry] = await getTripRoster(db, trip.id);
  if (!rosterEntry) throw new Error("demo booking missing");
  const [template] = await listWaiverTemplates(db, shop.id);
  if (!template) throw new Error("demo waiver template missing");
  return { db, shop, trip, booking: rosterEntry.booking, template };
}

describe("waiver records (in-memory PGlite)", () => {
  it("stores only a token hash and rejects a tampered link", async () => {
    const { db, shop, booking, template } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      templateId: template.id,
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
    const { db, shop, trip, booking, template } = await waiverContext();
    const first = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      templateId: template.id,
      now,
    });
    const second = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      templateId: template.id,
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
      templateId: template.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    const newer = await createWaiverTemplate(db, {
      shopId: shop.id,
      title: template.title,
      body: "A materially different v2 release.",
      makeDefault: true,
    });
    expect(newer.version).toBe(2);

    const state = await getWaiverForToken(db, issued.token, now);
    expect(state).toMatchObject({
      state: "available",
      record: { templateVersion: 1, templateBody: template.body },
    });
  });

  it("makes completion idempotent and routes a medical yes to review", async () => {
    const { db, shop, booking, template } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      templateId: template.id,
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
    const { db, shop, booking, template } = await waiverContext();
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      templateId: template.id,
      now,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    expect(await getWaiverForToken(db, issued.token, issued.expiresAt)).toEqual({
      state: "expired",
    });
    expect(
      await issueWaiverRequest(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId: booking.id,
        templateId: template.id,
        now,
      }),
    ).toEqual({ ok: false, reason: "booking_not_found" });
  });

  it("does not issue a waiver for a cancelled trip", async () => {
    const { db, shop, trip, booking, template } = await waiverContext();
    await setTripStatus(db, shop.id, trip.id, "cancelled");
    expect(
      await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: booking.id,
        templateId: template.id,
        now,
      }),
    ).toEqual({ ok: false, reason: "booking_unavailable" });
  });

  it("lets staff select a different active default template", async () => {
    const { db, shop } = await waiverContext();
    const other = await createWaiverTemplate(db, {
      shopId: shop.id,
      title: "Boat Charter Release",
      body: "Charter release.",
    });
    expect(await setDefaultWaiverTemplate(db, shop.id, other.id)).toBe(true);
    const templates = await listWaiverTemplates(db, shop.id);
    expect(templates.find((template) => template.isDefault)?.id).toBe(other.id);
  });
});
