import { and, eq, isNull } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { createBookingParty } from "@/db/bookings";
import { bookingCapabilities, bookings, waiverRecords } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { diverTranslator } from "@/i18n/messages";
import { medicalQuestionField, questionnaireForJurisdiction } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

/**
 * **The release signed as the thread's Sign step** (issue #2743): the readiness
 * link opens, drafts and signs the seat's own release in place, against a real
 * record, and no second credential is minted along the way.
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
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.10") }));
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
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, delete: () => undefined })),
}));

const { getDb } = await import("@/db/client");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { issueWaiverRequest } = await import("@/db/waivers");
const { completeWaiverFromReady, openWaiverFromReady, saveWaiverDraftFromReady } = await import(
  "./waiver-actions"
);
const { default: ThreadWaiverPage } = await import("./waiver/page");

const t = diverTranslator("en-US");

async function redirectedTo(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

/** A booked seat on an upcoming trip, and its diver's readiness link. */
async function bookedSeat(fullName: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("seeded shop has no upcoming trip");
  const slug = fullName.toLowerCase().replace(/\W+/g, ".");
  const party = await createBookingParty(db, [
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName, email: `${slug}@example.com` },
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: `${fullName} Buddy` },
  ]);
  if (!party.ok || !party.bookings[0] || !party.bookings[1]) throw new Error("booking failed");
  const bookingId = party.bookings[0].bookingId;
  const readiness = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId,
    purpose: "readiness",
  });
  if (!readiness) throw new Error("readiness unavailable");
  return {
    db,
    shop,
    bookingId,
    buddyBookingId: party.bookings[1].bookingId,
    token: readiness.token,
  };
}

/** Every primary question answered "no", which needs no physician. */
function signedForm(
  shop: { jurisdiction: Parameters<typeof questionnaireForJurisdiction>[0] },
  fields: Record<string, string>,
): FormData {
  const form = new FormData();
  const questionnaire = questionnaireForJurisdiction(shop.jurisdiction);
  for (const question of questionnaire.questions) {
    if (!question.parentId) form.set(medicalQuestionField(question.id), "no");
  }
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

async function liveRecords(db: typeof ctx.db, bookingId: string) {
  return db
    .select()
    .from(waiverRecords)
    .where(and(eq(waiverRecords.bookingId, bookingId), isNull(waiverRecords.supersededAt)));
}

async function capabilityCount(db: typeof ctx.db, bookingId: string) {
  const rows = await db
    .select({ id: bookingCapabilities.id })
    .from(bookingCapabilities)
    .where(eq(bookingCapabilities.bookingId, bookingId));
  return rows.length;
}

async function renderPage(token: string, search: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await ThreadWaiverPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve(search),
    }),
  );
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("signing the release in the diver's thread", () => {
  it("opens the seat's release on the readiness link itself", async () => {
    const { db, shop, bookingId, token } = await bookedSeat("Iris Inplace");
    expect(await redirectedTo(() => openWaiverFromReady(token))).toBe(`/ready/${token}/waiver`);
    const [record] = await liveRecords(db, bookingId);
    expect(record?.status).toBe("pending");
    expect(record?.shopId).toBe(shop.id);
    const html = await renderPage(token);
    expect(html).toContain(t("waiver.signButton"));
    expect(html).toContain(t("waiver.backToPrep"));
    // No second link anywhere on the page, and no expiry for one.
    expect(html).not.toContain("/waivers/");
    expect(html).not.toContain(t("waiver.linkExpiresAt", { date: "" }).split("{")[0]?.slice(0, 20));
  });

  it("keeps the release a staffer already sent, and the draft typed into it", async () => {
    const { db, shop, bookingId, token } = await bookedSeat("Kit Keeper");
    const sent = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!sent.ok) throw new Error("waiver request refused");
    await redirectedTo(() => openWaiverFromReady(token));
    expect(
      await redirectedTo(() =>
        saveWaiverDraftFromReady(token, signedForm(shop, { signerName: "Kit Keeper" })),
      ),
    ).toBe(`/ready/${token}/waiver?saved=1`);
    await redirectedTo(() => openWaiverFromReady(token));
    const live = await liveRecords(db, bookingId);
    expect(live.map((record) => record.id)).toEqual([sent.recordId]);
    expect(live[0]?.draftSignerName).toBe("Kit Keeper");
  });

  it("signs under the name on file and returns to the checklist, minting nothing", async () => {
    const { db, shop, bookingId, token } = await bookedSeat("Noa Nomint");
    await redirectedTo(() => openWaiverFromReady(token));
    const before = await capabilityCount(db, bookingId);
    expect(
      await redirectedTo(() =>
        completeWaiverFromReady(
          token,
          signedForm(shop, { signerName: "Noa Nomint", acknowledged: "on" }),
        ),
      ),
    ).toBe(`/ready/${token}?saved=waiver`);
    const [record] = await liveRecords(db, bookingId);
    expect(record?.status).toBe("completed");
    expect(record?.signedName).toBe("Noa Nomint");
    expect(record?.integrityHash).toBeTruthy();
    // Reloading the signed release mints nothing and sends the diver home.
    expect(await redirectedTo(() => renderPage(token))).toBe(`/ready/${token}`);
    expect(await capabilityCount(db, bookingId)).toBe(before);
  });

  it("sends a signature under another name back to the name field", async () => {
    const { db, shop, bookingId, token } = await bookedSeat("Rowan Right");
    await redirectedTo(() => openWaiverFromReady(token));
    const target = await redirectedTo(() =>
      completeWaiverFromReady(
        token,
        signedForm(shop, { signerName: "Someone Else", acknowledged: "on" }),
      ),
    );
    expect(target).toMatch(
      new RegExp(`^/ready/${token}/waiver\\?error=invalid&field=signerNameMismatch&at=`),
    );
    const [record] = await liveRecords(db, bookingId);
    expect(record?.status).toBe("pending");
  });

  it("shows a referred signer the receipt, with the doctor's page on the same link", async () => {
    const { db, shop, bookingId, token } = await bookedSeat("Sky Referral");
    await redirectedTo(() => openWaiverFromReady(token));
    const form = signedForm(shop, { signerName: "Sky Referral", acknowledged: "on" });
    form.set(medicalQuestionField("q3"), "yes");
    expect(await redirectedTo(() => completeWaiverFromReady(token, form))).toBe(
      `/ready/${token}/waiver`,
    );
    const [record] = await liveRecords(db, bookingId);
    expect(record?.status).toBe("medical_review");
    const html = await renderPage(token);
    expect(html).toContain(t("waiver.medicalReferralNext"));
    expect(html).toContain(`/ready/${token}/waiver/doctor`);
    expect(html).not.toContain("/waivers/");
  });

  it("throttles before reading anything", async () => {
    const { shop, token } = await bookedSeat("Tess Throttle");
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1_000 });
    expect(await redirectedTo(() => openWaiverFromReady(token))).toBe(`/ready/${token}?error=rate`);
    expect(
      await redirectedTo(() =>
        completeWaiverFromReady(
          token,
          signedForm(shop, { signerName: "Tess Throttle", acknowledged: "on" }),
        ),
      ),
    ).toBe(`/ready/${token}?error=rate`);
  });

  it("never reaches another seat's release, even on the same party", async () => {
    const { db, shop, bookingId, buddyBookingId, token } = await bookedSeat("Lee Lead");
    // The buddy's release exists; this link's own seat has none yet.
    const buddy = await issueWaiverRequest(db, { shopId: shop.id, bookingId: buddyBookingId });
    if (!buddy.ok) throw new Error("waiver request refused");
    expect(
      await redirectedTo(() =>
        completeWaiverFromReady(
          token,
          signedForm(shop, { signerName: "Lee Lead Buddy", acknowledged: "on" }),
        ),
      ),
    ).toBe(`/ready/${token}`);
    expect(await redirectedTo(() => renderPage(token))).toBe(`/ready/${token}`);
    const [buddyRecord] = await liveRecords(db, buddyBookingId);
    expect(buddyRecord?.status).toBe("pending");
    expect(await liveRecords(db, bookingId)).toHaveLength(0);
  });

  it("refuses a release issued before the seat changed hands", async () => {
    const { db, shop, bookingId, buddyBookingId, token } = await bookedSeat("Moe Mover");
    await redirectedTo(() => openWaiverFromReady(token));
    // The seat moves to the buddy, whose own seat is let go; the release still names Moe.
    const [buddySeat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, buddyBookingId));
    if (!buddySeat) throw new Error("buddy seat missing");
    await db.delete(bookings).where(eq(bookings.id, buddyBookingId));
    await db
      .update(bookings)
      .set({ personId: buddySeat.personId })
      .where(eq(bookings.id, bookingId));
    expect(
      await redirectedTo(() =>
        completeWaiverFromReady(
          token,
          signedForm(shop, { signerName: "Moe Mover", acknowledged: "on" }),
        ),
      ),
    ).toBe(`/ready/${token}`);
    const [record] = await liveRecords(db, bookingId);
    expect(record?.status).toBe("pending");
  });

  it("closes on a cancelled seat", async () => {
    const { db, shop, bookingId, token } = await bookedSeat("Cam Cancel");
    await redirectedTo(() => openWaiverFromReady(token));
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    expect(
      await redirectedTo(() =>
        completeWaiverFromReady(
          token,
          signedForm(shop, { signerName: "Cam Cancel", acknowledged: "on" }),
        ),
      ),
    ).toBe(`/ready/${token}`);
    expect(await redirectedTo(() => renderPage(token))).toBe(`/ready/${token}`);
  });
});
