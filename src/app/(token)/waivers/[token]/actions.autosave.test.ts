import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingParty } from "@/db/bookings";
import { capabilities, waiverRecords } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { claimedDevice, issueCounterLink, openOnDevice } from "@/db/waivers-test-fixtures";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { medicalQuestionField, questionnaireForJurisdiction } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

/**
 * **A slow signer keeps what they typed** (issue #3985): the counter form
 * saves its draft on each step without leaving the page, a closed code says
 * to ask the staff for a fresh one, and the throttle is the claimed phone's,
 * not the shop Wi-Fi's.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
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
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    delete: ({ name }: { name: string }) => cookieJar.delete(name),
  })),
}));

const { getDb } = await import("@/db/client");
const { checkRateLimit, rateLimitKey } = await import("@/lib/rate-limit");
const { closedCounterCode } = await import("@/db/waivers");
const { autosaveWaiverDraftAction } = await import("./actions");

async function counterSeat() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("seeded shop has no upcoming trip");
  const party = await createBookingParty(db, [
    { actor: "staff", shopId: shop.id, tripId: trip.id, fullName: "Slow Signer" },
  ]);
  if (!party.ok || !party.bookings[0]) throw new Error("booking failed");
  const link = await issueCounterLink(db, {
    shopId: shop.id,
    bookingId: party.bookings[0].bookingId,
  });
  await openOnDevice(db, link.token);
  const device = claimedDevice(link.token);
  if (!device) throw new Error("counter link not claimed");
  cookieJar.set("diveday_counter_device", device);
  return { db, shop, ...link, device };
}

/** The first page of the questionnaire, answered "no". */
function firstStep(shop: { jurisdiction: Parameters<typeof questionnaireForJurisdiction>[0] }) {
  const form = new FormData();
  for (const question of questionnaireForJurisdiction(shop.jurisdiction).questions) {
    if (!question.parentId) form.set(medicalQuestionField(question.id), "no");
  }
  form.set("signerName", "Slow Signer");
  return form;
}

beforeEach(() => {
  cookieJar.clear();
  vi.mocked(checkRateLimit).mockClear();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("saving a counter draft on each step (issue 3985)", () => {
  it("saves the draft and stays on the page", async () => {
    const { db, shop, token, recordId } = await counterSeat();

    expect(await autosaveWaiverDraftAction(token, firstStep(shop))).toBe("saved");

    const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
    expect(record?.status).toBe("pending");
    expect(record?.draftMedicalAnswers).not.toBeNull();
  });

  it("spends the claimed phone's budget, not the shop Wi-Fi's", async () => {
    const { shop, token } = await counterSeat();

    await autosaveWaiverDraftAction(token, firstStep(shop));

    const keys = vi.mocked(checkRateLimit).mock.calls.map(([key]) => key);
    expect(keys).not.toContain(rateLimitKey("waiver-token", "203.0.113.9"));
    expect(keys.length).toBeGreaterThan(0);
  });

  it("saves on its own budget, never the one the signature needs", async () => {
    const { db, shop, token } = await counterSeat();
    const [link] = await db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(eq(capabilities.tokenHash, hashBearerToken(token)));
    if (!link) throw new Error("counter link missing");

    await autosaveWaiverDraftAction(token, firstStep(shop));

    const keys = vi.mocked(checkRateLimit).mock.calls.map(([key]) => key);
    expect(keys).toContain(rateLimitKey("waiver-autosave", "claim", link.id));
    expect(keys).not.toContain(rateLimitKey("waiver-action", "claim", link.id));
  });

  it("stops a flood of forged claim cookies before any read", async () => {
    const { shop, token } = await counterSeat();
    cookieJar.set("diveday_counter_device", "forged");
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1_000 });
    expect(await autosaveWaiverDraftAction(token, firstStep(shop))).toBe("rate");
  });

  it("answers a closed code without saving, and says so", async () => {
    const { db, shop, token, recordId } = await counterSeat();
    await db
      .update(capabilities)
      .set({ revokedAt: nowDate() })
      .where(eq(capabilities.tokenHash, hashBearerToken(token)));

    expect(await autosaveWaiverDraftAction(token, firstStep(shop))).toBe("closed");
    const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
    expect(record?.draftMedicalAnswers).toBeNull();
  });

  it("names the shop behind a counter code that has closed, and nothing behind a live one", async () => {
    const { db, shop, token } = await counterSeat();
    expect(await closedCounterCode(db, token)).toBeNull();
    const later = new Date(nowDate().getTime() + 31 * 60 * 1000);
    expect(await closedCounterCode(db, token, later)).toEqual({ shopId: shop.id });
    expect(await closedCounterCode(db, "not-a-real-token", later)).toBeNull();
  });

  it("refuses anything but a string posted as the link", async () => {
    const { shop } = await counterSeat();
    expect(await autosaveWaiverDraftAction({} as unknown as string, firstStep(shop))).toBe(
      "closed",
    );
  });
});
