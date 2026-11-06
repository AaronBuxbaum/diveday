import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { createBookingParty } from "@/db/bookings";
import { bookingCapabilities, capabilities, people, waiverRecords } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { claimedDevice, issueCounterLink, openOnDevice } from "@/db/waivers-test-fixtures";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { medicalQuestionField, questionnaireForJurisdiction } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

/**
 * The signing form's two doors, which were closures inside `page.tsx` until they moved here.
 * They now read the link's context (record, questionnaire, guardian rule) from the token at
 * submit rather than from the render's scope, so these cases hold the whole path against a real
 * waiver record: the throttle, a dead link, a refused field, a draft, and a signature.
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
vi.mock("@/lib/observability/render-connection", () => ({
  connectionForRoute: vi.fn(async () => undefined),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
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
const { checkRateLimit } = await import("@/lib/rate-limit");
const { issueWaiverRequest } = await import("@/db/waivers");
const { completeWaiverAction, saveWaiverDraftAction } = await import("./actions");

/** The phone that opened the counter link first, holding its claim cookie. */
async function onThisPhone(db: Parameters<typeof openOnDevice>[0], token: string) {
  await openOnDevice(db, token);
  const device = claimedDevice(token);
  if (!device) throw new Error("counter link not claimed");
  cookieJar.set("diveday_counter_device", device);
}

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

/** A fresh waiver link for an adult on the seeded shop, with no booking behind it. */
async function openLink() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shop.id), isNull(people.dateOfBirth), isNull(people.deletedAt)))
    .limit(1);
  if (!person) throw new Error("seeded shop has no person without a date of birth");
  const issued = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id });
  if (!issued.ok) throw new Error(`waiver request refused: ${issued.reason}`);
  return { db, shop, person, token: issued.token, recordId: issued.recordId };
}

/** A booked seat on an upcoming trip, with its holder's readiness link. */
async function bookedSeat(fullName: string) {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("seeded shop has no upcoming trip");
  const slug = `${fullName.toLowerCase().replace(/\W+/g, ".")}.${crypto.randomUUID().slice(0, 6)}`;
  const party = await createBookingParty(db, [
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName, email: `${slug}@example.com` },
  ]);
  if (!party.ok || !party.bookings[0]) throw new Error("booking failed");
  const bookingId = party.bookings[0].bookingId;
  const readiness = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId,
    purpose: "readiness",
  });
  if (!readiness) throw new Error("readiness link missing");
  return { bookingId, readiness: readiness.token };
}

/** When the counter link was spent, or null while it is not. */
async function linkUsedAt(token: string) {
  const [row] = await ctx.db
    .select({ usedAt: capabilities.usedAt })
    .from(capabilities)
    .where(eq(capabilities.tokenHash, hashBearerToken(token)));
  return row?.usedAt ?? null;
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

beforeEach(() => {
  cookieJar.clear();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("the signing doors", () => {
  it("throttle before reading anything", async () => {
    const { token, shop } = await openLink();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1_000 });
    expect(await redirectedTo(() => saveWaiverDraftAction(token, signedForm(shop, {})))).toBe(
      `/waivers/${token}?error=rate`,
    );
    expect(await redirectedTo(() => completeWaiverAction(token, signedForm(shop, {})))).toBe(
      `/waivers/${token}?error=rate`,
    );
  });

  it("answer a link that names no open record as unavailable", async () => {
    const { shop } = await openLink();
    const dead = "not-a-real-token";
    expect(await redirectedTo(() => completeWaiverAction(dead, signedForm(shop, {})))).toBe(
      `/waivers/${dead}?error=unavailable`,
    );
  });

  it("refuse anything but a string posted as the link (security review of issue 2743, F1)", async () => {
    const { db, shop, recordId } = await openLink();
    const forged = { kind: "thread", shopId: shop.id, bookingId: crypto.randomUUID(), recordId };
    const posted = forged as unknown as string;
    expect(await redirectedTo(() => completeWaiverAction(posted, signedForm(shop, {})))).toBe("/");
    expect(await redirectedTo(() => saveWaiverDraftAction(posted, signedForm(shop, {})))).toBe("/");
    const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
    expect(record?.status).toBe("pending");
  });

  it("save a draft through the link", async () => {
    const { db, token, shop, recordId } = await openLink();
    expect(
      await redirectedTo(() =>
        saveWaiverDraftAction(token, signedForm(shop, { signerName: "Half Way" })),
      ),
    ).toBe(`/waivers/${token}?saved=1`);
    const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
    expect(record?.status).toBe("pending");
    expect(record?.draftMedicalAnswers).not.toBeNull();
  });

  it("send a signature under another name back to the name field", async () => {
    const { token, shop } = await openLink();
    const target = await redirectedTo(() =>
      completeWaiverAction(
        token,
        signedForm(shop, { signerName: "Somebody Else Entirely", acknowledged: "on" }),
      ),
    );
    expect(target).toMatch(
      new RegExp(`^/waivers/${token}\\?error=invalid&field=signerNameMismatch&at=\\w+#`),
    );
  });

  it("sign the release under the name on file", async () => {
    const { db, token, shop, person, recordId } = await openLink();
    expect(
      await redirectedTo(() =>
        completeWaiverAction(
          token,
          signedForm(shop, { signerName: person.fullName, acknowledged: "on" }),
        ),
      ),
    ).toBe(`/waivers/${token}`);
    const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
    expect(record?.status).not.toBe("pending");
  });

  it("refuses to sign or draft a seat's release through its waiver link (issue #2743)", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const { bookingId } = await bookedSeat("Morgan Waiver");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error("waiver request refused");
    const form = () => signedForm(shop, { signerName: "Morgan Waiver", acknowledged: "on" });
    expect(await redirectedTo(() => completeWaiverAction(issued.token, form()))).toBe(
      `/waivers/${issued.token}?error=unavailable`,
    );
    expect(await redirectedTo(() => saveWaiverDraftAction(issued.token, form()))).toBe(
      `/waivers/${issued.token}?error=unavailable`,
    );
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(record?.status).toBe("pending");
    expect(record?.draftSignerName).toBeNull();
  });

  it("signs a seat on its counter link, spends it, and grants no trip prep", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const { bookingId } = await bookedSeat("Casey Counter");
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId });
    await onThisPhone(db, link.token);
    const before = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, bookingId));
    const form = () => signedForm(shop, { signerName: "Casey Counter", acknowledged: "on" });
    expect(await redirectedTo(() => saveWaiverDraftAction(link.token, form()))).toBe(
      `/waivers/${link.token}?saved=1`,
    );
    // A draft spends nothing.
    expect(await linkUsedAt(link.token)).toBeNull();
    expect(await redirectedTo(() => completeWaiverAction(link.token, form()))).toBe(
      `/waivers/${link.token}`,
    );
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, link.recordId));
    expect(record?.status).toBe("completed");
    expect(await linkUsedAt(link.token)).not.toBeNull();
    // Spent: no second draft or signature lands, and the receipt is all it shows.
    expect(await redirectedTo(() => saveWaiverDraftAction(link.token, form()))).toBe(
      `/waivers/${link.token}?error=unavailable`,
    );
    // A second Sign is told its answers were not saved (attacker review S1).
    expect(await redirectedTo(() => completeWaiverAction(link.token, form()))).toBe(
      `/waivers/${link.token}?error=signed`,
    );
    const after = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, bookingId));
    expect(after).toHaveLength(before.length);
  });

  it("refuses a counter signature under another name without spending the link", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const { bookingId } = await bookedSeat("Robin Counter");
    const link = await issueCounterLink(db, { shopId: shop.id, bookingId });
    await onThisPhone(db, link.token);
    const target = await redirectedTo(() =>
      completeWaiverAction(
        link.token,
        signedForm(shop, { signerName: "Somebody Else Entirely", acknowledged: "on" }),
      ),
    );
    expect(target).toMatch(
      new RegExp(`^/waivers/${link.token}\\?error=invalid&field=signerNameMismatch&at=\\w+#`),
    );
    expect(await linkUsedAt(link.token)).toBeNull();
  });

  /**
   * Issue #2743: a counter link signs its own seat and returns to its own
   * receipt, whatever a cookie carries; a referral lands there too.
   */
  it.each(["diveday_waiver_return", "diveday_party_return"])(
    "never sends a counter signer to a readiness link carried in %s",
    async (cookie) => {
      const { db, shop } = ctx;
      vi.mocked(getDb).mockResolvedValue(db);
      const { bookingId, readiness } = await bookedSeat("Taylor Readiness");
      const link = await issueCounterLink(db, { shopId: shop.id, bookingId });
      await onThisPhone(db, link.token);
      cookieJar.set(cookie, readiness);
      const form = signedForm(shop, { signerName: "Taylor Readiness", acknowledged: "on" });
      form.set(medicalQuestionField("q3"), "yes");
      expect(await redirectedTo(() => completeWaiverAction(link.token, form))).toBe(
        `/waivers/${link.token}`,
      );
    },
  );
});
