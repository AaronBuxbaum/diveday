import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The checkout's gear ticks write the fit only of a diver this booking is
 * sure it is.**
 *
 * `bookSpot` persists each party member's priced gear as their rental fit the
 * moment the seat exists (ADR 20260801-checkout-upsells-rental-gear). A seat
 * held on a shared email (H-13) attached itself to an *existing* person whose
 * name on file does not match the one typed, so the booker may be somebody
 * else, and the fit is that diver's standing record. A rented wetsuit ticked
 * there would clear their `dives_dry` and, with it, the drysuit weight check
 * on every later trip (`security-reviewer`, layer 2 of the H-78 work).
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({}) as never) }));
vi.mock("@/db/shops", () => ({ getShopBySlug: vi.fn() }));
vi.mock("@/db/trips", () => ({ getTripWithBooked: vi.fn() }));
vi.mock("@/db/bookings", () => ({
  createBookingParty: vi.fn(),
  getBookingForTrip: vi.fn(async () => null),
}));
vi.mock("@/db/checkouts", () => ({ startBookingCheckout: vi.fn(async () => null) }));
vi.mock("@/db/buddy-referrals", () => ({
  resolveBuddyReferral: vi.fn(async () => null),
  recordBuddyReferral: vi.fn(),
}));
vi.mock("@/db/booking-capabilities", () => ({ issueBookingCapability: vi.fn(async () => null) }));
vi.mock("@/db/booking-handoff", () => ({
  consumeBookingHandoff: vi.fn(),
  offerBookingHandoffByEmail: vi.fn(),
}));
vi.mock("@/db/people", () => ({ recordDiverOwnLocaleForBooking: vi.fn() }));
vi.mock("@/db/notifications", () => ({ sendAndRecordNotification: vi.fn() }));
vi.mock("@/db/waiver-issue", () => ({ issueWaiverOnJoin: vi.fn() }));
vi.mock("@/db/nitrox", () => ({ setBookingNitrox: vi.fn() }));
vi.mock("@/db/rental-fit", () => ({ saveRentalFit: vi.fn(async () => ({})) }));
vi.mock("@/db/stripe-accounts", () => ({
  getShopStripeAccount: vi.fn(async () => ({})),
  canAcceptPayments: vi.fn(() => true),
}));
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, publicAppUrl: vi.fn(() => "https://diveday.test") };
});
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
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
const { saveRentalFit } = await import("@/db/rental-fit");
const { bookSpot } = await import("./actions");

const SHOP_ID = "8a1f0c2e-1111-4222-8333-444444444444";
const TRIP_ID = "9b2e1d3f-5555-4666-8777-888888888888";

/** A shop that prices rental gear online, so the checkout asks for it. */
const shop = {
  id: SHOP_ID,
  slug: "blue-mantis",
  rentalItems: ["bcd", "wetsuit", "drysuit"],
  rentalPricing: { setCents: null, perItemCents: { wetsuit: 1200 }, nitroxCents: null },
  passThroughFee: null,
};
/** A paid departure, so the checkout runs and the gear step with it. */
const trip = {
  id: TRIP_ID,
  courseId: null,
  course: null,
  plannedDives: 2,
  priceCents: 9_000,
  startsAt: new Date("2026-07-24T13:30:00.000Z"),
};

function wetsuitBooking(): FormData {
  const form = new FormData();
  form.set("partySize", "1");
  form.set("fullName-0", "Somebody Else");
  form.set("email-0", "dana@example.com");
  form.set("gear-0-wetsuit", "on");
  return form;
}

async function book(identityUnconfirmed: boolean) {
  vi.mocked(createBookingParty).mockResolvedValue({
    ok: true,
    bookings: [
      { bookingId: "booking-1", personId: "dana", personName: "Dry Dana", identityUnconfirmed },
    ],
  });
  // The action ends in a redirect, which the mock throws.
  await bookSpot({ shopSlug: "blue-mantis", tripId: TRIP_ID, embed: false }, {}, wetsuitBooking())
    .then(() => undefined)
    .catch((error: unknown) => {
      if (!(error instanceof Error && error.message.startsWith("REDIRECT:"))) throw error;
    });
}

beforeEach(() => {
  vi.mocked(getShopBySlug).mockResolvedValue(shop as never);
  vi.mocked(getTripWithBooked).mockResolvedValue(trip as never);
});
afterEach(() => vi.clearAllMocks());

describe("gear ticked at checkout", () => {
  it("leaves a held seat's matched diver's fit alone, dives_dry and all", async () => {
    await book(true);
    expect(saveRentalFit).not.toHaveBeenCalled();
  });

  it("records the fit of a diver the booking is sure of", async () => {
    // The control: the same post on a confirmed seat is what reaches the
    // packing list, so the guard above is the only thing standing between.
    await book(false);
    expect(saveRentalFit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ personId: "dana", rentsWetsuit: true, rentsDrysuit: false }),
    );
  });
});
