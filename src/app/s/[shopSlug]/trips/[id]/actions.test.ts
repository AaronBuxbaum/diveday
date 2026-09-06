import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 * That is what these cover. A POST carrying every field the old form posted
 * must reach `createBookingParty` with no declaration on it, must not turn the
 * gate advisory on its behalf, and must cost the submitter exactly one token
 * however many claims it carries. The bucket mechanics themselves are
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
// `bookSpot` reads the partner-referral cookie (issue #1285), and there is no
// request scope here for `cookies()` to find. An empty jar rather than a
// planted value: these tests are about what the *declaration* fields do, and a
// booking nobody referred is the ordinary case they were written against.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { getShopBySlug } = await import("@/db/shops");
const { getTripWithBooked } = await import("@/db/trips");
const { createBookingParty } = await import("@/db/bookings");
const { checkRateLimit, RATE_LIMITS } = await import("@/lib/rate-limit");
const { bookSpot } = await import("./actions");

const SHOP_ID = "8a1f0c2e-1111-4222-8333-444444444444";
const TRIP_ID = "9b2e1d3f-5555-4666-8777-888888888888";

/** A shop with nothing priced, so the gear/checkout branches stay out of the way. */
const shop = { id: SHOP_ID, slug: "blue-mantis", rentalPricing: null, rentalItems: [] };
/** A free departure: no per-diver price means no Stripe lookup and no gear step. */
const trip = {
  id: TRIP_ID,
  courseId: null,
  course: null,
  plannedDives: 2,
  priceCents: null,
  // Three days out on the suite's frozen clock, so D18's window is open unless
  // a test moves it.
  startsAt: new Date("2026-07-24T13:30:00.000Z"),
};

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

function bookingRateLimitCalls(): number {
  return vi.mocked(checkRateLimit).mock.calls.filter(([, config]) => config === RATE_LIMITS.booking)
    .length;
}

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

describe("the booking form's certification fields", () => {
  it("carries no declaration into the booking, however many a post claims", async () => {
    await bookSpot(
      ref(TRIP_ID),
      {},
      submission([
        { email: "booker@example.com", level: "rescue", agency: "padi", number: "RS-1" },
        { email: "victim@example.com", level: "instructor", agency: "ssi", number: "IN-2" },
      ]),
    );

    const [, requests] = vi.mocked(createBookingParty).mock.calls[0] ?? [];
    expect(requests).toHaveLength(2);
    for (const request of requests ?? []) {
      // Nothing an anonymous submitter typed reaches `recordSelfDeclaredCards`.
      expect(request.declared).toBeUndefined();
      // And the gate is not softened on the strength of an answer nobody gave:
      // `advise` was earned by the form warning a diver as they answered.
      expect(request.admissionGate).toBeUndefined();
    }
  });

  it("costs one token per submission, not one per claim", async () => {
    // The count-scaled charge existed to price the declaration writes a
    // booking could make. With none to write, what is left is the protection
    // against repeated empty submissions.
    await bookSpot(
      ref(TRIP_ID),
      {},
      submission([
        { email: "one@example.com", level: "rescue" },
        { email: "two@example.com", level: "rescue" },
        { email: "three@example.com", level: "rescue" },
        { email: "four@example.com", level: "rescue" },
        { email: "five@example.com", level: "rescue" },
        { email: "six@example.com", level: "rescue" },
      ]),
    );

    expect(bookingRateLimitCalls()).toBe(1);
  });

  it("still refuses a submission the per-IP bucket has run out for", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1_000 });

    const state = await bookSpot(ref(TRIP_ID), {}, submission([{ email: "spray@example.com" }]));

    expect(state.error).toBeTruthy();
    // Refused before the seats are taken, not after.
    expect(createBookingParty).not.toHaveBeenCalled();
  });
});

/**
 * **The two optional questions are not asked here** (ADR
 * 20260904-reef-all-the-way-down, D12 and D18; moved 2026-09-06).
 *
 * "What's this dive for?" and the three offers under it were posted from this
 * form and written onto the lead's row until both moved to `/ready/<token>`,
 * which asks them after the sale, of the diver whose seat it is. What is left
 * worth pinning is that a hand-crafted post carrying either field is *ignored*
 * rather than refused or, worse, written: this form is anonymous, so a
 * fabricated answer must never reach a booking and must never cost anybody a
 * seat either.
 */
describe("what this dive is for, and what would help", () => {
  it("ignores both fields when a hand-crafted post carries them", async () => {
    const form = submission([{ email: "booker@example.com" }]);
    form.set("diveIntent", "easing_back");
    form.set("reEntryAsk", "deck_word");

    const state = await bookSpot(ref(TRIP_ID), {}, form);

    expect(state.fieldErrors).toBeUndefined();
    const [, requests] = vi.mocked(createBookingParty).mock.calls[0] ?? [];
    expect(requests?.[0]?.diveIntent).toBeUndefined();
    expect(requests?.[0]?.reEntryAsk).toBeUndefined();
  });
});
