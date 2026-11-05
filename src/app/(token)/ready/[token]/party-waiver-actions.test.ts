import { and, eq, isNull } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { createBookingParty } from "@/db/bookings";
import { bookingCapabilities, waiverRecords } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { medicalQuestionField, questionnaireForJurisdiction } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

/**
 * **A parent signs a child's release on their own link** (issue #2743,
 * H-20261014-parent-signs-minor-release). The lead's readiness link opens,
 * drafts and signs the seat's release at `/ready/<lead>/party/<seat>/waiver`,
 * against a real record: no waiver link is minted, no cookie carries the
 * lead's token, and every other link or seat reaches nothing.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn(), connection: vi.fn(async () => undefined) };
});
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.11") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});
vi.mock("@/i18n/request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/request")>();
  return {
    ...actual,
    requestFirstHandLocale: vi.fn(async () => "en-US"),
    requestLocale: vi.fn(async () => "en-US"),
  };
});
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
const cookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: cookieSet, delete: () => undefined })),
}));

const { getDb } = await import("@/db/client");
const { signMinorWaiverAction } = await import("./party-actions");
const { completeMinorWaiver, saveMinorWaiverDraft } = await import("./party-waiver-actions");
const { default: PartySeatWaiverPage } = await import("./party/[seatId]/waiver/page");
const { default: PartySeatDoctorPage } = await import("./party/[seatId]/waiver/doctor/page");

const t = diverTranslator("en-US");

async function redirectedTo(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("returned without redirecting");
}

/** A parent, their declared-minor child and an adult friend, and the parent's link. */
async function family(tag: string, tripIndex = 0) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const trip = (await upcomingTripsWithCounts(db, shop.id))[tripIndex];
  if (!trip) throw new Error("seeded shop has no upcoming trip");
  const party = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: trip.id,
      fullName: `Dana ${tag}`,
      email: `dana.${tag.toLowerCase()}@example.com`,
    },
    {
      actor: "public",
      shopId: shop.id,
      tripId: trip.id,
      fullName: `Mia ${tag}`,
      minorDeclared: true,
    },
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: `Lee ${tag}` },
  ]);
  if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
  const [lead, mia, lee] = party.bookings;
  if (!lead || !mia || !lee) throw new Error("party incomplete");
  const link = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: lead.bookingId,
    purpose: "readiness",
  });
  if (!link) throw new Error("readiness unavailable");
  return { db, shop, lead, mia, lee, token: link.token };
}

function seatForm(seatBookingId: string): FormData {
  const form = new FormData();
  form.set("bookingId", seatBookingId);
  return form;
}

function signedForm(
  shop: { jurisdiction: Parameters<typeof questionnaireForJurisdiction>[0] },
  fields: Record<string, string>,
): FormData {
  const form = new FormData();
  for (const question of questionnaireForJurisdiction(shop.jurisdiction).questions) {
    if (!question.parentId) form.set(medicalQuestionField(question.id), "no");
  }
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

const asGuardian = (tag: string) => ({
  signerName: `Mia ${tag}`,
  acknowledged: "on",
  guardianName: `Dana ${tag}`,
  guardianRelationship: "parent",
  guardianAcknowledged: "on",
});

async function liveRecord(bookingId: string) {
  const [record] = await ctx.db
    .select()
    .from(waiverRecords)
    .where(and(eq(waiverRecords.bookingId, bookingId), isNull(waiverRecords.supersededAt)));
  return record;
}

async function renderPage(token: string, seatId: string) {
  return renderToStaticMarkup(
    await PartySeatWaiverPage({
      params: Promise.resolve({ token, seatId }),
      searchParams: Promise.resolve({}),
    }),
  );
}

beforeEach(() => {
  cookieSet.mockClear();
});

describe("a parent signs a child's release on their own link", () => {
  it("opens, signs and returns to the party panel, with no waiver link or cookie", async () => {
    const { db, shop, mia, token } = await family("Oak");
    const path = `/ready/${token}/party/${mia.bookingId}/waiver`;
    expect(await redirectedTo(() => signMinorWaiverAction(token, seatForm(mia.bookingId)))).toBe(
      path,
    );
    expect(cookieSet).not.toHaveBeenCalled();
    const html = await renderPage(token, mia.bookingId);
    expect(html).toContain(t("waiver.signButton"));
    expect(html).not.toContain("/waivers/");
    const drawn = await liveRecord(mia.bookingId);
    if (!drawn) throw new Error("no release opened");

    expect(
      await redirectedTo(() =>
        completeMinorWaiver(token, mia.bookingId, drawn.id, signedForm(shop, asGuardian("Oak"))),
      ),
    ).toBe(`/ready/${token}#party-seats`);
    expect(await liveRecord(mia.bookingId)).toMatchObject({
      id: drawn.id,
      status: "completed",
      guardianName: "Dana Oak",
    });
    // Nothing for the child's seat was minted along the way.
    expect(
      await db
        .select({ id: bookingCapabilities.id })
        .from(bookingCapabilities)
        .where(eq(bookingCapabilities.bookingId, mia.bookingId)),
    ).toEqual([]);
    // Signed and clear: the page has nothing more to offer.
    expect(await redirectedTo(() => renderPage(token, mia.bookingId))).toBe(
      `/ready/${token}#party-seats`,
    );
  });

  it("reaches nothing from another lead's link, an adult's seat, or a malformed seat id", async () => {
    const { shop, mia, lee, token } = await family("Elm");
    const stranger = await family("Ash", 1);
    await redirectedTo(() => signMinorWaiverAction(token, seatForm(mia.bookingId)));
    const drawn = await liveRecord(mia.bookingId);
    if (!drawn) throw new Error("no release opened");
    const strangerPanel = `/ready/${stranger.token}#party-seats`;
    expect(await redirectedTo(() => renderPage(stranger.token, mia.bookingId))).toBe(strangerPanel);
    expect(
      await redirectedTo(() =>
        completeMinorWaiver(
          stranger.token,
          mia.bookingId,
          drawn.id,
          signedForm(shop, asGuardian("Elm")),
        ),
      ),
    ).toBe(strangerPanel);
    expect(
      await redirectedTo(() =>
        saveMinorWaiverDraft(stranger.token, mia.bookingId, drawn.id, signedForm(shop, {})),
      ),
    ).toBe(strangerPanel);
    expect(await redirectedTo(() => renderPage(token, lee.bookingId))).toBe(
      `/ready/${token}#party-seats`,
    );
    expect(await redirectedTo(() => renderPage(token, "not-a-seat"))).toBe(
      `/ready/${token}#party-seats`,
    );
    expect(await redirectedTo(() => renderPage("not-a-token", mia.bookingId))).toBe(
      "/ready/not-a-token",
    );
    expect(await liveRecord(mia.bookingId)).toMatchObject({ id: drawn.id, status: "pending" });
  });

  it("signs only the release the page drew", async () => {
    const { shop, mia, token } = await family("Fir");
    const path = `/ready/${token}/party/${mia.bookingId}/waiver`;
    await redirectedTo(() => signMinorWaiverAction(token, seatForm(mia.bookingId)));
    const drawn = await liveRecord(mia.bookingId);
    if (!drawn) throw new Error("no release opened");
    expect(
      await redirectedTo(() =>
        completeMinorWaiver(
          token,
          mia.bookingId,
          "another-record",
          signedForm(shop, asGuardian("Fir")),
        ),
      ),
    ).toBe(path);
    expect(await liveRecord(mia.bookingId)).toMatchObject({ id: drawn.id, status: "pending" });
  });

  it("shows a referral's receipt and doctor's page, and never a second form", async () => {
    const { shop, mia, token } = await family("Yew");
    const path = `/ready/${token}/party/${mia.bookingId}/waiver`;
    await redirectedTo(() => signMinorWaiverAction(token, seatForm(mia.bookingId)));
    const drawn = await liveRecord(mia.bookingId);
    if (!drawn) throw new Error("no release opened");
    const referred = signedForm(shop, asGuardian("Yew"));
    referred.set(medicalQuestionField("q3"), "yes");
    expect(
      await redirectedTo(() => completeMinorWaiver(token, mia.bookingId, drawn.id, referred)),
    ).toBe(path);
    expect(await liveRecord(mia.bookingId)).toMatchObject({ status: "medical_review" });

    const receipt = await renderPage(token, mia.bookingId);
    expect(receipt).toContain(t("waiver.medicalReferralNext"));
    expect(receipt).toContain(`${path}/doctor`);
    expect(receipt).not.toContain(t("waiver.signButton"));
    const doctor = renderToStaticMarkup(
      await PartySeatDoctorPage({ params: Promise.resolve({ token, seatId: mia.bookingId }) }),
    );
    expect(doctor).toContain(t("waiver.doctor.title"));

    // The physician door is not a signing door: a second signature is refused.
    expect(
      await redirectedTo(() =>
        completeMinorWaiver(token, mia.bookingId, drawn.id, signedForm(shop, asGuardian("Yew"))),
      ),
    ).toBe(path);
    expect(await liveRecord(mia.bookingId)).toMatchObject({ status: "medical_review" });
  });
});
