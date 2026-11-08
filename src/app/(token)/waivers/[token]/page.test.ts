import { and, eq, ne } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { bookingCapabilities, bookings, trips, waiverRecords } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { recordDoorDraft } from "@/db/waiver-drafts";
import { completeWaiver, recordWaiverDraft, threadWaiverKey } from "@/db/waivers-completion";
import { recordMedicalEvaluation } from "@/db/waivers-medical";
import { issueWaiverRequest } from "@/db/waivers-requests";
import {
  claimedDevice,
  clearAnswers,
  issueCounterLink,
  medicalReferralAnswers,
  now,
  openOnDevice,
  waiverContextFor,
} from "@/db/waivers-test-fixtures";
import { diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();
const context = waiverContextFor(ctx);
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  })),
}));
vi.mock("@/lib/observability/render-connection", () => ({
  connectionForRoute: vi.fn(async () => undefined),
}));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US"),
  requestFirstHandLocale: vi.fn(async () => null),
}));
const { getDb } = await import("@/db/client");
const { default: WaiverPage } = await import("./page");
const t = diverTranslator("en-US");
const renderToken = async (token: string, search: { error?: string } = {}) =>
  renderToStaticMarkup(
    await WaiverPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve(search) }),
  );
/** Render a counter link on the phone that opened it first. */
async function renderOnDevice(db: Parameters<typeof openOnDevice>[0], token: string, search = {}) {
  const door = await openOnDevice(db, token);
  const device = claimedDevice(token);
  if (device) cookieJar.set("diveday_counter_device", device);
  return { door, html: await renderToken(token, search) };
}
afterEach(() => {
  cookieJar.clear();
  vi.clearAllMocks();
});
/** A signed release with no seat: the one kind of waiver link `/waivers/<token>` still opens. */
async function signed(answers: typeof clearAnswers = medicalReferralAnswers) {
  const fixture = await context();
  vi.mocked(getDb).mockResolvedValue(fixture.db);
  const issued = await issueWaiverRequest(fixture.db, {
    shopId: fixture.shop.id,
    personId: fixture.booking.personId,
    now,
  });
  if (!issued.ok || issued.key.kind !== "release") throw new Error("expected a release link");
  const { token } = issued.key;
  await completeWaiver(fixture.db, issued.key, {
    signerName: fixture.person.fullName,
    agreed: true,
    medicalAnswers: answers,
    now,
  });
  const render = async () => renderToken(token);
  const where = and(
    eq(waiverRecords.id, issued.recordId),
    eq(waiverRecords.shopId, fixture.shop.id),
  );
  return { ...fixture, issued, render, where };
}
describe("the actual completed waiver branch", () => {
  it("renders the referral receipt without exposing answers or claiming clearance", async () => {
    const { render } = await signed();
    const html = await render();
    expect(html).toContain(t("waiver.signedBody"));
    expect(html).toContain(t("waiver.medicalReferralNext"));
    // The doctor's page is on a seat's own thread link; a waiver link opens none.
    expect(html).not.toContain(t("waiver.doctor.open"));
    expect(html).toContain('data-medical-next="referral"');
    expect(html).not.toContain("moderate exercise");
  });
  it("offers no return door to a readiness link carried in a cookie (issue #2743)", async () => {
    const { db, shop, booking, render } = await signed();
    const readiness = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: booking.id,
      purpose: "readiness",
    });
    if (!readiness) throw new Error("readiness unavailable");
    cookieJar.set("diveday_waiver_return", readiness.token);
    const html = await render();
    expect(html).toContain(t("waiver.medicalReferralNext"));
    expect(html).not.toContain(t("waiver.seeWhatsLeft"));
    expect(html).not.toContain("/ready/");
  });
  it("keeps physician refusal distinct on the waiver receipt", async () => {
    const { db, shop, booking, render } = await signed();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("staff missing");
    const outcome = await recordMedicalEvaluation(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      personId: booking.personId,
      recordedByPersonId: staff.person.id,
      outcome: "not_cleared",
      evaluatedOn: "2026-07-18",
      physicianName: "Dr. Example",
      now: new Date(now.getTime() + 60_000),
    });
    expect(outcome.ok).toBe(true);
    const html = await render();
    expect(html).toContain(t("waiver.medicalDeclinedNext"));
    expect(html).not.toContain(t("waiver.medicalReferralNext"));
    expect(html).not.toContain(t("waiver.doctor.open"));
  });
  it("offers no readiness link on a waiver link's referral receipt (issue #2743)", async () => {
    const { db, shop, booking, render } = await signed();
    const [lead] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shop.id),
          eq(bookings.tripId, booking.tripId),
          ne(bookings.id, booking.id),
        ),
      )
      .limit(1);
    if (!lead) throw new Error("party lead missing");
    await db
      .update(bookings)
      .set({ partyLeadBookingId: lead.id })
      .where(eq(bookings.id, booking.id));
    const readiness = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: lead.id,
      purpose: "readiness",
    });
    if (!readiness) throw new Error("readiness unavailable");
    cookieJar.set("diveday_party_return", readiness.token);
    const html = await render();
    expect(html).toContain(t("waiver.medicalReferralNext"));
    expect(html).not.toContain(t("waiver.doctor.open"));
    expect(html.includes(`/ready/${readiness.token}`)).toBe(false);
  });
  it.each([
    null,
    { ...medicalReferralAnswers, questionnaireVersion: 999 },
    { ...medicalReferralAnswers, responses: {} },
  ])("presents incomplete/status-only medical as shop review", async (medicalAnswers) => {
    const { db, where, render } = await signed();
    await db.update(waiverRecords).set({ medicalAnswers }).where(where);
    const html = await render();
    expect(html).toContain(t("waiver.medicalShopReviewNext"));
    expect(html).toContain('data-medical-next="shop_review"');
    expect(html).not.toContain(t("waiver.medicalReferralNext"));
    expect(html).not.toContain(t("waiver.doctor.open"));
  });
  it("acknowledges a sent private form without rendering its stored URL or implying clearance", async () => {
    const { db, where, render } = await signed();
    await db
      .update(waiverRecords)
      .set({
        diverMedicalFormUrl: "https://media.example.test/private-form.jpg",
        diverMedicalFormSentAt: now,
      })
      .where(where);
    const html = await render();
    expect(html).toContain(t("waiver.medicalFormWaiting"));
    expect(html).not.toContain("media.example.test");
    expect(html).not.toContain(t("waiver.doctor.open"));
  });
  it("a signed standalone release keeps its receipt without granting trip prep", async () => {
    const { db, booking, render } = await signed(clearAnswers);
    const before = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, booking.id));
    const html = await render();
    expect(html).toContain(t("waiver.signedBody"));
    expect(html).not.toContain("/ready/");
    expect(html).not.toContain(t("waiver.seeWhatsLeft"));
    expect(html).not.toContain("data-medical-next=");
    const after = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, booking.id));
    expect(after).toHaveLength(before.length);
  });
  it("a counter form says how long the code has, and a closed code asks the staff for a fresh one (issue 3985)", async () => {
    const { db, shop, booking } = await context();
    vi.mocked(getDb).mockResolvedValue(db);
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    const { html: form } = await renderOnDevice(db, link.token);
    expect(form).toContain('data-testid="counter-time-left"');
    expect(form).not.toContain(t("waiver.saveForLater"));
    vi.stubEnv("DIVEDAY_CLOCK", new Date(link.expiresAt.getTime() + 60_000).toISOString());
    const closed = await renderToken(link.token);
    vi.unstubAllEnvs();
    expect(closed).toContain(t("waiver.counterClosedNext"));
  });

  it("a counter receipt shows no doctor's page or readiness, and closes at expiry, a fresh QR or supersession", async () => {
    const { db, shop, booking, person } = await context();
    vi.mocked(getDb).mockResolvedValue(db);
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    const before = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, booking.id));
    const { door, html: form } = await renderOnDevice(db, link.token);
    expect(form).toContain(t("waiver.signButton"));
    if (door?.door !== "counter") throw new Error("counter door missing");
    const outcome = await completeWaiver(db, door.key, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
    });
    expect(outcome).toMatchObject({ ok: true, status: "medical_review" });
    const live = await renderToken(link.token);
    expect(live).toContain(t("waiver.signedBody"));
    expect(live).toContain(t("waiver.medicalReferralNext"));
    expect(live).not.toContain(t("waiver.doctor.open"));
    expect(live).not.toContain("/doctor");
    expect(live).not.toContain("/ready/");
    expect(live).not.toContain(t("waiver.seeWhatsLeft"));
    vi.stubEnv("DIVEDAY_CLOCK", link.expiresAt.toISOString());
    const expired = await renderToken(link.token);
    expect(expired).not.toContain(t("waiver.signedBody"));
    expect(expired).not.toContain("/ready/");
    vi.unstubAllEnvs();
    await db
      .update(waiverRecords)
      .set({ supersededAt: nowDate() })
      .where(eq(waiverRecords.id, link.recordId));
    const superseded = await renderToken(link.token);
    expect(superseded).not.toContain(t("waiver.signedBody"));
    const after = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, booking.id));
    expect(after).toHaveLength(before.length);
  });
  it("a counter link on a cancelled seat opens nothing; on a cancelled departure it makes no trip claim", async () => {
    const { db, shop, booking } = await context();
    vi.mocked(getDb).mockResolvedValue(db);
    const [trip] = await db
      .select({ title: trips.title })
      .from(trips)
      .where(eq(trips.id, booking.tripId));
    if (!trip) throw new Error("trip missing");
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, booking.tripId));
    const { html: departure } = await renderOnDevice(db, link.token);
    expect(departure).toContain(t("waiver.independentTitle"));
    expect(departure).not.toContain(t("waiver.beforeDockTitle"));
    expect(departure).not.toContain(trip.title);
    expect(departure).toContain(t("waiver.signButton"));
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    const seat = await renderToken(link.token);
    expect(seat).not.toContain(t("waiver.signButton"));
    expect(seat).not.toContain(t("waiver.emailFreshLink"));
  });
  it("a counter QR opens the form on any phone, with no claim step (issue 4064)", async () => {
    const { db, shop, booking } = await context();
    vi.mocked(getDb).mockResolvedValue(db);
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    expect(await renderToken(link.token)).toContain(t("waiver.signButton"));
    await openOnDevice(db, link.token);
    expect(await renderToken(link.token)).toContain(t("waiver.signButton"));
  });
  it("a counter form never shows the medical answers or alert the diver saved in their thread (security S2)", async () => {
    const { db, shop, booking } = await context();
    vi.mocked(getDb).mockResolvedValue(db);
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    await recordDoorDraft(
      db,
      { shopId: shop.id, recordId: link.recordId, door: "thread", linkId: null },
      {
        signerName: null,
        acknowledged: false,
        medicalAnswers: medicalReferralAnswers,
        medicalAlert: "Stent placed in June",
        now: nowDate(),
      },
    );
    const { html } = await renderOnDevice(db, link.token);
    expect(html).toContain(t("waiver.signButton"));
    expect(html).not.toMatch(/value="yes"[^>]*checked=""|checked=""[^>]*value="yes"/);
    expect(html).not.toContain("Stent placed in June");
  });
  it("a counter form keeps what was saved through this claimed code, and a fresh code shows none of it (dock B1)", async () => {
    const { db, shop, booking } = await context();
    vi.mocked(getDb).mockResolvedValue(db);
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    const door = await openOnDevice(db, link.token);
    if (door?.door !== "counter") throw new Error("counter door missing");
    // What a refused Sign or "Save and finish later" writes before redrawing.
    await recordWaiverDraft(db, door.key, {
      acknowledged: false,
      medicalAnswers: medicalReferralAnswers,
      medicalAlert: "Stent placed in June",
    });
    const { html } = await renderOnDevice(db, link.token, { error: "invalid" });
    expect(html).toMatch(/value="yes"[^>]*checked=""|checked=""[^>]*value="yes"/);
    expect(html).toContain("Stent placed in June");
    cookieJar.clear();
    // Another phone on the same code opens the form, without those answers (issue 4064).
    const elsewhere = await renderToken(link.token);
    expect(elsewhere).toContain(t("waiver.signButton"));
    expect(elsewhere).not.toMatch(/value="yes"[^>]*checked=""|checked=""[^>]*value="yes"/);
    expect(elsewhere).not.toContain("Stent placed in June");
    const fresh = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    const { html: bystander } = await renderOnDevice(db, fresh.token);
    expect(bystander).toContain(t("waiver.signButton"));
    expect(bystander).not.toMatch(/value="yes"[^>]*checked=""|checked=""[^>]*value="yes"/);
    expect(bystander).not.toContain("Stent placed in June");
  });
  it("a counter form says the diver gave the crew an alert last time, without its words (dock S1)", async () => {
    const { db, shop, booking, person } = await context();
    vi.mocked(getDb).mockResolvedValue(db);
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    const earlier = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id, now });
    if (!earlier.ok) throw new Error("earlier release missing");
    expect(
      await completeWaiver(db, earlier.key, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        medicalAlert: "Type 1 diabetic, glucose in BCD pocket",
        now,
      }),
    ).toMatchObject({ ok: true });
    // A thread draft on this release must not hide the hint on the counter.
    await recordDoorDraft(
      db,
      { shopId: shop.id, recordId: link.recordId, door: "thread", linkId: null },
      { signerName: null, acknowledged: false, medicalAnswers: clearAnswers, now: nowDate() },
    );
    const { html } = await renderOnDevice(db, link.token);
    expect(html).toContain(t("waiver.signButton"));
    expect(html).toContain(t("waiver.medicalAlertEarlier"));
    expect(html).not.toContain("Type 1 diabetic");
  });
  it("a counter submit that finds its release signed says what was entered was not saved (attacker S1)", async () => {
    const { db, shop, booking, person } = await context();
    vi.mocked(getDb).mockResolvedValue(db);
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    const door = await openOnDevice(db, link.token);
    if (door?.door !== "counter") throw new Error("counter door missing");
    await completeWaiver(db, door.key, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    const { html } = await renderOnDevice(db, link.token, { error: "signed" });
    expect(html).toContain(t("waiver.counterAlreadySigned"));
    expect((await renderOnDevice(db, link.token)).html).not.toContain(
      t("waiver.counterAlreadySigned"),
    );
  });
  it("a counter code whose release the thread signed first says not saved, and shows no receipt (issue #4044)", async () => {
    const { db, shop, booking, person } = await context();
    vi.mocked(getDb).mockResolvedValue(db);
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId: booking.id });
    await openOnDevice(db, link.token);
    const thread = await threadWaiverKey(db, { shopId: shop.id, bookingId: booking.id });
    if (!thread) throw new Error("thread key missing");
    await completeWaiver(db, thread, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
    });
    const { html } = await renderOnDevice(db, link.token, { error: "signed" });
    expect(html).toContain(t("waiver.signedElsewhereTitle"));
    expect(html).toContain(t("waiver.counterAlreadySigned"));
    expect(html).toContain(shop.name);
    // Nothing of the signed release: no receipt, no medical state.
    expect(html).not.toContain(t("waiver.signedBody"));
    expect(html).not.toContain("data-medical-next");
    // Without a refused Sign it is a link that opens nothing.
    expect((await renderOnDevice(db, link.token)).html).not.toContain(
      t("waiver.signedElsewhereTitle"),
    );
  });
});
