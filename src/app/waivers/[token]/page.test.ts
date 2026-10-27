import { and, eq, ne } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookingCapabilities, bookings, waiverRecords } from "@/db/schema";
import { completeWaiver } from "@/db/waivers-completion";
import { issueWaiverRequest } from "@/db/waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "@/db/waivers-test-fixtures";
import { diverTranslator } from "@/i18n/messages";
import { nowDate } from "@/lib/clock";
import { sealCounterWaiverToken } from "@/lib/counter-waiver-token";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();
const context = waiverContextFor(ctx);
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
afterEach(() => vi.clearAllMocks());
async function signed(answers: typeof clearAnswers = medicalReferralAnswers) {
  const fixture = await context();
  vi.mocked(getDb).mockResolvedValue(fixture.db);
  const issued = await issueWaiverRequest(fixture.db, {
    shopId: fixture.shop.id,
    bookingId: fixture.booking.id,
    now,
  });
  if (!issued.ok) throw new Error("expected live waiver");
  await completeWaiver(fixture.db, issued.token, {
    signerName: fixture.person.fullName,
    agreed: true,
    medicalAnswers: answers,
    now,
  });
  const render = async () =>
    renderToStaticMarkup(
      await WaiverPage({
        params: Promise.resolve({ token: issued.token }),
        searchParams: Promise.resolve({}),
      }),
    );
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
    expect(html).toContain(t("waiver.doctor.open"));
    expect(html).toContain('data-medical-next="referral"');
    expect(html).not.toContain("moderate exercise");
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
  it("a signed clear release keeps its receipt and preparation door", async () => {
    const { render } = await signed(clearAnswers);
    const html = await render();
    expect(html).toContain(t("waiver.signedBody"));
    expect(html).toContain(t("waiver.seeWhatsLeft"));
    expect(html).not.toContain("data-medical-next=");
  });
  it("a lead's counter receipt cannot mint readiness after completion, expiry or supersession", async () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    try {
      const { db, shop, booking, issued, where } = await signed(clearAnswers);
      const [sibling] = await db
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
      if (!sibling) throw new Error("party sibling missing");
      await db
        .update(bookings)
        .set({ partyLeadBookingId: booking.id })
        .where(eq(bookings.id, sibling.id));
      const expiresAt = new Date(nowDate().getTime() + 60_000);
      const envelope = sealCounterWaiverToken(issued.token, expiresAt);
      if (!envelope) throw new Error("envelope missing");
      const renderCounter = async () =>
        renderToStaticMarkup(
          await WaiverPage({
            params: Promise.resolve({ token: envelope }),
            searchParams: Promise.resolve({}),
          }),
        );
      const before = await db
        .select({ id: bookingCapabilities.id })
        .from(bookingCapabilities)
        .where(
          and(
            eq(bookingCapabilities.bookingId, booking.id),
            eq(bookingCapabilities.purpose, "readiness"),
          ),
        );
      const live = await renderCounter();
      expect(live).toContain(t("waiver.counterSigned"));
      expect(live).not.toContain(issued.token);
      expect(live).not.toContain("/ready/");
      expect(live).not.toContain(t("waiver.seeWhatsLeft"));
      vi.stubEnv("DIVEDAY_CLOCK", expiresAt.toISOString());
      const expired = await renderCounter();
      expect(expired).not.toContain("/ready/");
      expect(expired).not.toContain(issued.token);
      expect(expired).not.toContain(t("waiver.counterSigned"));
      vi.stubEnv("DIVEDAY_CLOCK", new Date(expiresAt.getTime() - 30_000).toISOString());
      await db.update(waiverRecords).set({ supersededAt: nowDate() }).where(where);
      const superseded = await renderCounter();
      expect(superseded).not.toContain("/ready/");
      expect(superseded).not.toContain(issued.token);
      expect(superseded).not.toContain(t("waiver.counterSigned"));
      const after = await db
        .select({ id: bookingCapabilities.id })
        .from(bookingCapabilities)
        .where(
          and(
            eq(bookingCapabilities.bookingId, booking.id),
            eq(bookingCapabilities.purpose, "readiness"),
          ),
        );
      expect(after).toHaveLength(before.length);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
