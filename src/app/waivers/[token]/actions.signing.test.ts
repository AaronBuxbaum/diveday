import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { createBookingParty } from "@/db/bookings";
import { bookingCapabilities, bookings, people, trips, waiverRecords } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { hashCapabilityToken } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
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
  return { ...actual, requestFirstHandLocale: vi.fn(async () => "en-US") };
});
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

  it("keeps a standalone signed waiver on its receipt without granting trip prep", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Morgan Waiver",
        email: "morgan.waiver@example.com",
      },
    ]);
    if (!party.ok || !party.bookings[0]) throw new Error("booking failed");
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: party.bookings[0].bookingId,
    });
    if (!issued.ok) throw new Error("waiver request refused");
    const before = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, party.bookings[0].bookingId));
    expect(
      await redirectedTo(() =>
        completeWaiverAction(
          issued.token,
          signedForm(shop, { signerName: "Morgan Waiver", acknowledged: "on" }),
        ),
      ),
    ).toBe(`/waivers/${issued.token}`);
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(record?.status).toBe("completed");
    const after = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, party.bookings[0].bookingId));
    expect(after).toHaveLength(before.length);
  });

  it("returns a signer to their separately authorized trip prep", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Taylor Readiness",
        email: "taylor.readiness@example.com",
      },
    ]);
    if (!party.ok || !party.bookings[0]) throw new Error("booking failed");
    const bookingId = party.bookings[0].bookingId;
    const readiness = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok || !readiness) throw new Error("links unavailable");
    cookieJar.set("diveday_waiver_return", readiness.token);
    const target = await redirectedTo(() =>
      completeWaiverAction(
        issued.token,
        signedForm(shop, { signerName: "Taylor Readiness", acknowledged: "on" }),
      ),
    );
    expect(target === `/ready/${readiness.token}`).toBe(true);
    expect(cookieJar.has("diveday_waiver_return")).toBe(false);
  });

  it("shows a referred signer the waiver receipt before returning to their trip prep", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Sam Referral",
        email: "sam.referral@example.com",
      },
    ]);
    if (!party.ok || !party.bookings[0]) throw new Error("booking failed");
    const bookingId = party.bookings[0].bookingId;
    const readiness = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok || !readiness) throw new Error("links unavailable");
    cookieJar.set("diveday_waiver_return", readiness.token);
    const form = signedForm(shop, { signerName: "Sam Referral", acknowledged: "on" });
    form.set(medicalQuestionField("q3"), "yes");
    const target = await redirectedTo(() => completeWaiverAction(issued.token, form));
    expect(target === `/waivers/${issued.token}`).toBe(true);
    expect(cookieJar.has("diveday_waiver_return")).toBe(true);
  });

  it.each([
    "other booking",
    "wrong purpose",
    "expired",
    "revoked",
    "cancelled booking",
    "cancelled departure",
  ] as const)(
    "does not return through an independently held link that is %s",
    async (condition) => {
      const { db, shop } = ctx;
      vi.mocked(getDb).mockResolvedValue(db);
      const [trip] = await upcomingTripsWithCounts(db, shop.id);
      if (!trip) throw new Error("seeded shop has no upcoming trip");
      const party = await createBookingParty(db, [
        {
          actor: "public",
          shopId: shop.id,
          tripId: trip.id,
          fullName: "Avery Scope",
          email: "avery.scope@example.com",
        },
        { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Riley Scope" },
      ]);
      if (!party.ok || !party.bookings[0] || !party.bookings[1]) throw new Error("booking failed");
      const bookingId = party.bookings[0].bookingId;
      const readiness = await issueBookingCapability(db, {
        shopId: shop.id,
        bookingId: condition === "other booking" ? party.bookings[1].bookingId : bookingId,
        purpose: condition === "wrong purpose" ? "confirm" : "readiness",
      });
      const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
      if (!issued.ok || !readiness) throw new Error("links unavailable");
      if (condition === "expired" || condition === "revoked") {
        await db
          .update(bookingCapabilities)
          .set(condition === "expired" ? { expiresAt: nowDate() } : { revokedAt: nowDate() })
          .where(eq(bookingCapabilities.tokenHash, hashCapabilityToken(readiness.token)));
      }
      if (condition === "cancelled booking") {
        await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
      }
      if (condition === "cancelled departure") {
        await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
      }
      cookieJar.set("diveday_waiver_return", readiness.token);
      const target = await redirectedTo(() =>
        completeWaiverAction(
          issued.token,
          signedForm(shop, { signerName: "Avery Scope", acknowledged: "on" }),
        ),
      );
      expect(target === `/waivers/${issued.token}`).toBe(true);
      expect(cookieJar.has("diveday_waiver_return")).toBe(false);
    },
  );

  /**
   * Dive-domain review F6 of layer r4-1: a parent who opened this from their
   * party panel lands back on it; a link that is not the seat's lead is
   * ignored, and the signer lands where every signer does.
   */
  it("send a parent who came from the party panel back to it", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Rae Returner",
        email: "rae.returner@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Sol Seat" },
    ]);
    if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
    const [lead, seat] = party.bookings;
    if (!lead || !seat) throw new Error("party incomplete");
    const leadLink = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: lead.bookingId,
      purpose: "readiness",
    });
    if (!leadLink) throw new Error("expected a readiness link");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: seat.bookingId });
    if (!issued.ok) throw new Error(`waiver request refused: ${issued.reason}`);
    cookieJar.set("diveday_party_return", leadLink.token);
    expect(
      await redirectedTo(() =>
        completeWaiverAction(
          issued.token,
          signedForm(shop, { signerName: "Sol Seat", acknowledged: "on" }),
        ),
      ),
    ).toBe(`/ready/${leadLink.token}#party-seats`);
    expect(cookieJar.has("diveday_party_return")).toBe(false);
  });

  it("shows a parent the referral instructions before returning to the party", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("seeded shop has no upcoming trip");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Rae Family",
        email: "rae.family@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Sol Family" },
    ]);
    if (!party.ok || !party.bookings[0] || !party.bookings[1]) throw new Error("party incomplete");
    const readiness = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: party.bookings[0].bookingId,
      purpose: "readiness",
    });
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: party.bookings[1].bookingId,
    });
    if (!issued.ok || !readiness) throw new Error("links unavailable");
    cookieJar.set("diveday_party_return", readiness.token);
    const form = signedForm(shop, { signerName: "Sol Family", acknowledged: "on" });
    form.set(medicalQuestionField("q3"), "yes");
    const target = await redirectedTo(() => completeWaiverAction(issued.token, form));
    expect(target === `/waivers/${issued.token}`).toBe(true);
    expect(cookieJar.has("diveday_party_return")).toBe(true);
  });
});
