import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import type { AppDb } from "@/db/client";
import { bookingCapabilities, bookings, certifications, people, shops } from "@/db/schema";
import { createTrip } from "@/db/trips-create";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";

/**
 * **The public booking form asks nothing about anybody's diving, and this
 * action reads nothing about it either.**
 *
 * It asked, per diver, between 2026-08-20 and 2026-08-27 (ADR
 * 20260820-attested-at-booking-verified-at-boarding and its 2026-08-27
 * amendment); `/ready/<token>` asks the diver whose booking it is instead.
 * The parse went with the fields rather than being left standing, for the
 * reason the nitrox tick was taken out of this action: an action that accepts
 * what no form renders is a route a hand-crafted POST has and an honest diver
 * does not — here, one that writes a self-declared certification onto a
 * **named person's** record from an anonymous page.
 *
 * The real action on a real database. Only the framework edge (`next/*`), the
 * request's IP and locale are stubbed; `createBookingParty` is the real one,
 * wrapped in a spy so a test can also read what the action asked of it, and
 * the rate limiter is spied the same way so a test can count tokens. The
 * bucket mechanics themselves are `src/lib/rate-limit.test.ts`'s.
 */

const ctx = fileScopedShopContext();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
// `bookSpot` reads the partner-referral cookie (issue #1285); an empty jar is
// the ordinary booking nobody referred.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/bookings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/bookings")>();
  return { ...actual, createBookingParty: vi.fn(actual.createBookingParty) };
});
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
// The locale is read off the request's cookies, which do not exist here. The
// words themselves stay real, so an error message that stopped resolving would
// still show up as an empty `state.error`.
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US" as const),
  requestFirstHandLocale: vi.fn(async () => "en-US" as const),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { getDb } = await import("@/db/client");
const { redirect } = await import("next/navigation");
const { createBookingParty } = await import("@/db/bookings");
const { checkRateLimit, RATE_LIMITS } = await import("@/lib/rate-limit");
const { bookSpot } = await import("./actions");
const { cookies } = await import("next/headers");

/**
 * A free departure three days out on the suite's frozen clock: no per-diver
 * price means no Stripe lookup and no gear step, and D18's window is open.
 */
async function freeDeparture(db: AppDb, shopId: string, capacity = 12) {
  vi.mocked(getDb).mockResolvedValue(db);
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId,
    title: "Free Two-Tank",
    startsAt: new Date(now.getTime() + 72 * HOUR_MS),
    endsAt: new Date(now.getTime() + 76 * HOUR_MS),
    capacity,
    plannedDives: 2,
  });
  if (!trip) throw new Error("test trip could not be created");
  return trip.id;
}

/**
 * One submission. `level` is written into the field name the form used to
 * render — these are hand-crafted posts by construction now, which is the
 * whole point of asserting on them.
 */
function submission(
  party: Array<{ email: string; level?: string; agency?: string; number?: string }>,
): FormData {
  const form = new FormData();
  form.set("partySize", String(party.length));
  party.forEach((member, index) => {
    form.set(`fullName-${index}`, `Diver ${index}`);
    form.set(`email-${index}`, member.email);
    if (member.level) form.set(`certificationLevel-${index}`, member.level);
    if (member.agency) form.set(`certificationAgency-${index}`, member.agency);
    if (member.number) form.set(`certificationNumber-${index}`, member.number);
  });
  return form;
}

/** Run the action; a successful booking ends in a redirect, which the mock throws. */
async function post(shopSlug: string, tripId: string, form: FormData) {
  try {
    return await bookSpot({ shopSlug, tripId, embed: false }, {}, form);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT:")) return null;
    throw error;
  }
}

/** The seats on `tripId`, each with the email of the person it is for. */
async function seats(db: AppDb, tripId: string) {
  return db
    .select({
      personId: bookings.personId,
      email: people.email,
      diveIntent: bookings.diveIntent,
      reEntryAsk: bookings.reEntryAsk,
      minorDeclaredAt: bookings.minorDeclaredAt,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(eq(bookings.tripId, tripId));
}

function bookingRateLimitCalls(): number {
  return vi.mocked(checkRateLimit).mock.calls.filter(([, config]) => config === RATE_LIMITS.booking)
    .length;
}

afterEach(() => vi.clearAllMocks());

describe("the booking form's certification fields", () => {
  it("carries no declaration into the booking, however many a post claims", async () => {
    const { db, shop } = ctx;
    const tripId = await freeDeparture(db, shop.id);

    await post(
      shop.slug,
      tripId,
      submission([
        { email: "booker@example.com", level: "rescue", agency: "padi", number: "RS-1" },
        { email: "victim@example.com", level: "instructor", agency: "ssi", number: "IN-2" },
      ]),
    );

    const [, requests] = vi.mocked(createBookingParty).mock.calls[0] ?? [];
    expect(requests).toHaveLength(2);
    for (const request of requests ?? []) {
      expect(request.declared).toBeUndefined();
      // And the gate is not softened on the strength of an answer nobody gave:
      // `advise` was earned by the form warning a diver as they answered.
      expect(request.admissionGate).toBeUndefined();
    }
    // Both seats exist, and nothing an anonymous submitter typed reached a
    // card on either person's record.
    const booked = await seats(db, tripId);
    expect(booked.map((seat) => seat.email).sort()).toEqual([
      "booker@example.com",
      "victim@example.com",
    ]);
    const cards = await db
      .select({ id: certifications.id })
      .from(certifications)
      .where(
        and(
          eq(certifications.shopId, shop.id),
          inArray(
            certifications.personId,
            booked.map((seat) => seat.personId),
          ),
        ),
      );
    expect(cards).toEqual([]);
  });

  it("costs one token per submission, not one per claim", async () => {
    // The count-scaled charge existed to price the declaration writes a
    // booking could make. With none to write, what is left is the protection
    // against repeated empty submissions.
    const { db, shop } = ctx;
    const tripId = await freeDeparture(db, shop.id);

    await post(
      shop.slug,
      tripId,
      submission(
        ["one", "two", "three", "four", "five", "six"].map((name) => ({
          email: `${name}@example.com`,
          level: "rescue",
        })),
      ),
    );

    expect(bookingRateLimitCalls()).toBe(1);
  });

  it("still refuses a submission the per-IP bucket has run out for", async () => {
    const { db, shop } = ctx;
    const tripId = await freeDeparture(db, shop.id);
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1_000 });

    const state = await post(shop.slug, tripId, submission([{ email: "spray@example.com" }]));

    expect(state?.error).toBeTruthy();
    // Refused before the seats are taken, not after.
    expect(await seats(db, tripId)).toEqual([]);
  });
});

/**
 * **The two optional questions are not asked here** (ADR
 * 20260904-reef-all-the-way-down, D12 and D18; moved 2026-09-06).
 *
 * "What's this dive for?" and the three offers under it were posted from this
 * form and written onto the lead's row until both moved to `/ready/<token>`,
 * which asks them after the sale, of the diver whose seat it is. A
 * hand-crafted post carrying either field is *ignored* rather than refused or,
 * worse, written: this form is anonymous, so a fabricated answer must never
 * reach a booking and must never cost anybody a seat either.
 */
describe("what this dive is for, and what would help", () => {
  it("ignores both fields when a hand-crafted post carries them", async () => {
    const { db, shop } = ctx;
    const tripId = await freeDeparture(db, shop.id);
    const form = submission([{ email: "booker@example.com" }]);
    form.set("diveIntent", "easing_back");
    form.set("reEntryAsk", "deck_word");

    const state = await post(shop.slug, tripId, form);

    expect(state?.fieldErrors).toBeUndefined();
    const [seat] = await seats(db, tripId);
    expect(seat).toMatchObject({ diveIntent: null, reEntryAsk: null });
  });
});

/**
 * **"Under 18", per member** (decision 2026-10-13, after H-21): the box beside
 * a member's name reaches that member's seat and no other.
 */
describe("the Under 18 box", () => {
  it("marks only the seat whose box was ticked", async () => {
    const { db, shop } = ctx;
    const tripId = await freeDeparture(db, shop.id);
    const form = submission([{ email: "parent@example.com" }, { email: "kid@example.com" }]);
    form.set("minor-1", "on");

    await post(shop.slug, tripId, form);

    const booked = await seats(db, tripId);
    const marked = Object.fromEntries(
      booked.map((seat) => [seat.email, seat.minorDeclaredAt !== null]),
    );
    expect(marked).toEqual({ "parent@example.com": false, "kid@example.com": true });
  });
});

/**
 * **The page a booking lands on is not the page the email carries** (security
 * review of layer r5-4, F1). Whoever submits the form proved only that they
 * know a name and an address, so the link handed to their browser is minted
 * undelivered, and "Your days" (every other seat that person holds) waits for
 * the confirmation email's own link, which only the inbox on file receives.
 */
describe("the readiness link after booking", () => {
  it("redirects on an undelivered link and mails a delivered one", async () => {
    const { db, shop } = ctx;
    const tripId = await freeDeparture(db, shop.id);

    await post(shop.slug, tripId, submission([{ email: "regular@example.com" }]));

    const landing = vi
      .mocked(redirect)
      .mock.calls.map(([path]) => String(path))
      .find((path) => path.startsWith("/ready/"));
    const token = landing?.slice("/ready/".length).split("?")[0];
    if (!token) throw new Error("the booking did not land on /ready");
    const opened = await verifyBookingCapability(db, { token, purpose: "readiness" });
    expect(opened?.delivered).toBe(false);

    const links = await db
      .select({ delivered: bookingCapabilities.delivered })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, opened?.bookingId ?? ""),
          eq(bookingCapabilities.purpose, "readiness"),
        ),
      );
    expect(links.map((link) => link.delivered).sort()).toEqual([false, true]);
  });
});

/**
 * A hotel's link credits the seats booked through it, and only while the
 * shop's partner links are on (the Features page): off, the same cookie
 * books like any unreferred visit.
 */
describe("the partner-link credit", () => {
  async function bookWithPartnerCookie(on: boolean) {
    const { db, shop } = ctx;
    await db.update(shops).set({ partnerLinksEnabled: on }).where(eq(shops.id, shop.id));
    const tripId = await freeDeparture(db, shop.id);
    const jar = { get: () => ({ name: "diveday_ref", value: `${shop.slug}:harbor-hotel` }) };
    vi.mocked(cookies).mockImplementation((async () => jar) as unknown as typeof cookies);
    try {
      await post(shop.slug, tripId, submission([{ email: "partner-guest@example.com" }]));
    } finally {
      vi.mocked(cookies).mockImplementation((async () => ({
        get: () => undefined,
      })) as unknown as typeof cookies);
    }
    const [row] = await db
      .select({ referralSource: bookings.referralSource })
      .from(bookings)
      .where(eq(bookings.tripId, tripId));
    return row?.referralSource;
  }

  it("credits the partner while partner links are on", async () => {
    expect(await bookWithPartnerCookie(true)).toBe("harbor-hotel");
  });

  it("books with no credit while partner links are off", async () => {
    expect(await bookWithPartnerCookie(false)).toBeNull();
  });
});
