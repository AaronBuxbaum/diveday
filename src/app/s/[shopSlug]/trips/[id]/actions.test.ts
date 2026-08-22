import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The narrow rate-limit net on the public booking form's **declaration write**.
 *
 * A completed public booking writes each diver's stated certification onto that
 * diver's record. `RATE_LIMITS.booking` is keyed by IP, which on its own lets
 * anyone who knows a name and an email address spray claims onto that person's
 * record from a rotating set of addresses — the same argument
 * `waiverLinkResendByBooking` makes about a diver's inbox. These cover which
 * budget gets spent and on whose behalf; the bucket mechanics themselves are
 * `src/lib/rate-limit.test.ts`'s.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({}) as never) }));
vi.mock("@/db/shops", () => ({ getShopBySlug: vi.fn() }));
vi.mock("@/db/trips", () => ({ getTripWithBooked: vi.fn() }));
vi.mock("@/db/bookings", () => ({ createBookingParty: vi.fn(), getBookingForTrip: vi.fn() }));
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

const { getShopBySlug } = await import("@/db/shops");
const { getTripWithBooked } = await import("@/db/trips");
const { createBookingParty } = await import("@/db/bookings");
const { clientIp } = await import("@/lib/request-ip");
const { checkRateLimit, RATE_LIMITS, rateLimitKey } = await import("@/lib/rate-limit");
const { bookSpot } = await import("./actions");

const SHOP_ID = "8a1f0c2e-1111-4222-8333-444444444444";
const TRIP_ID = "9b2e1d3f-5555-4666-8777-888888888888";

/** A shop with nothing priced, so the gear/checkout branches stay out of the way. */
const shop = { id: SHOP_ID, slug: "blue-mantis", rentalPricing: null, rentalItems: [] };
/** A free departure: no per-diver price means no Stripe lookup and no gear step. */
const trip = { id: TRIP_ID, courseId: null, course: null, plannedDives: 2, priceCents: null };

/**
 * One submission. `declared` is the certification answer per seat — `null` is
 * the select's own "Rather not say", which writes nothing.
 */
function submission(party: Array<{ email: string; level?: string }>): FormData {
  const form = new FormData();
  form.set("partySize", String(party.length));
  party.forEach((member, index) => {
    form.set(`fullName-${index}`, `Diver ${index}`);
    form.set(`email-${index}`, member.email);
    if (member.level) form.set(`certificationLevel-${index}`, member.level);
  });
  return form;
}

/** Every key spent against the per-person declaration budget, in order. */
function declarationKeys(): string[] {
  return vi
    .mocked(checkRateLimit)
    .mock.calls.filter(([, config]) => config === RATE_LIMITS.declarationByPerson)
    .map(([key]) => key);
}

const keyFor = (email: string) => rateLimitKey("declaration", SHOP_ID, email);

const ref = (tripId: string) => ({ shopSlug: "blue-mantis", tripId, embed: false });

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(getShopBySlug).mockResolvedValue(shop as never);
  vi.mocked(getTripWithBooked).mockResolvedValue(trip as never);
  vi.mocked(createBookingParty).mockResolvedValue({
    ok: false,
    reason: "trip_unavailable",
    failedIndex: -1,
  } as never);
});
afterEach(() => vi.clearAllMocks());

describe("the declaration budget", () => {
  it("is spent on the diver the claim is about, not on the diver submitting", async () => {
    // The whole reason this is not keyed to the lead booker: a party names up
    // to six people, so a bucket on the submitter is cleared by putting the
    // victim in seat two and using a fresh lead address each time.
    await bookSpot(
      ref(TRIP_ID),
      {},
      submission([
        { email: "booker@example.com" },
        { email: "victim@example.com", level: "rescue" },
      ]),
    );

    expect(declarationKeys()).toEqual([keyFor("victim@example.com")]);
  });

  it("does not depend on the address the submission came from", async () => {
    // A rotating set of IPs is exactly the attack the per-IP net cannot see.
    const form = () => submission([{ email: "victim@example.com", level: "rescue" }]);
    vi.mocked(clientIp).mockResolvedValueOnce("203.0.113.7");
    await bookSpot(ref(TRIP_ID), {}, form());
    vi.mocked(clientIp).mockResolvedValueOnce("198.51.100.42");
    await bookSpot(ref(TRIP_ID), {}, form());

    const [first, second] = declarationKeys();
    expect(first).toBe(keyFor("victim@example.com"));
    expect(second).toBe(first);
  });

  it("is not spent by a seat that answered nothing", async () => {
    // "Rather not say" writes no claim, so there is no record to protect and
    // no reason to charge an honest booker's budget for it.
    await bookSpot(ref(TRIP_ID), {}, submission([{ email: "quiet@example.com" }]));

    expect(declarationKeys()).toEqual([]);
  });

  it("refuses the booking when this diver's record has already been written to", async () => {
    vi.mocked(checkRateLimit).mockImplementation(async (_key, config) => ({
      allowed: config !== RATE_LIMITS.declarationByPerson,
      retryAfterMs: 0,
    }));

    const state = await bookSpot(
      ref(TRIP_ID),
      {},
      submission([{ email: "victim@example.com", level: "rescue" }]),
    );

    expect(state.error).toBeTruthy();
    // Refused before the seats are taken, not after — the whole submission
    // stops rather than booking and then failing to write.
    expect(createBookingParty).not.toHaveBeenCalled();
  });

  it("leaves a second departure for the same diver alone", async () => {
    // The legitimate case the ceiling has to clear: a diver booking a week of
    // diving spends one token per departure, well inside 5/hour.
    const form = () => submission([{ email: "regular@example.com", level: "rescue" }]);
    await bookSpot(ref(TRIP_ID), {}, form());
    await bookSpot(ref("0c3d2e4a-9999-4aaa-8bbb-cccccccccccc"), {}, form());

    expect(declarationKeys()).toEqual([
      keyFor("regular@example.com"),
      keyFor("regular@example.com"),
    ]);
    expect(createBookingParty).toHaveBeenCalledTimes(2);
    expect(RATE_LIMITS.declarationByPerson.capacity).toBeGreaterThan(2);
  });
});
