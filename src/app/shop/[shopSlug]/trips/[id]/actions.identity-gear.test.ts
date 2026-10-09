// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { redirectedTo, staffSession } from "@/test/staff-session";

/**
 * **A held seat's paid gear follows the answer to "who is this?"**
 *
 * The checkout keeps a held seat's paid rental pieces on the booking, never on
 * the matched person's fit (dive-domain review of issue #2144). Once the desk
 * answers, they belong on a fit: on "Same person" only when the staffer keeps
 * the offer ticked, since it rewrites a standing record; on "Different person"
 * always, since the record is brand new and the gear is the seat's own.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/db/bookings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/bookings")>();
  return { ...actual, confirmBookingIdentity: vi.fn(), splitBookingIdentity: vi.fn() };
});
vi.mock("@/db/waiver-issue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/waiver-issue")>();
  return { ...actual, sendReleasesOnceIdentityKnown: vi.fn(async () => "not_needed") };
});
vi.mock("@/db/rental-fit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/rental-fit")>();
  return { ...actual, applyPaidRentalKindsToFit: vi.fn(async () => true) };
});

const { requireShopSurface } = await import("@/lib/session");
const { confirmBookingIdentity, splitBookingIdentity } = await import("@/db/bookings");
const { applyPaidRentalKindsToFit } = await import("@/db/rental-fit");
const { confirmDiverIdentityAction, splitDiverIdentityAction } = await import("./actions");

const SHOP_SLUG = "reef-life";
const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const BOOKING_ID = "44444444-4444-4444-8444-444444444444";

function signIn() {
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: SHOP_ID, shopSlug: SHOP_SLUG, personId: STAFF_ID }),
  } as never);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set("bookingId", BOOKING_ID);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

afterEach(() => vi.clearAllMocks());

describe("Same person, with gear paid for at checkout", () => {
  it("carries the paid pieces to the fit when the offer stays ticked", async () => {
    signIn();
    vi.mocked(confirmBookingIdentity).mockResolvedValue(true as never);
    await redirectedTo(() =>
      confirmDiverIdentityAction(SHOP_SLUG, TRIP_ID, form({ applyPaidGear: "on" })),
    );
    expect(applyPaidRentalKindsToFit).toHaveBeenCalledWith(expect.anything(), {
      shopId: SHOP_ID,
      bookingId: BOOKING_ID,
    });
  });

  it("leaves the standing fit alone when the staffer unticks it", async () => {
    signIn();
    vi.mocked(confirmBookingIdentity).mockResolvedValue(true as never);
    await redirectedTo(() => confirmDiverIdentityAction(SHOP_SLUG, TRIP_ID, form({})));
    expect(applyPaidRentalKindsToFit).not.toHaveBeenCalled();
  });

  it("writes nothing when the confirm was refused", async () => {
    signIn();
    vi.mocked(confirmBookingIdentity).mockResolvedValue(false as never);
    await redirectedTo(() =>
      confirmDiverIdentityAction(SHOP_SLUG, TRIP_ID, form({ applyPaidGear: "on" })),
    );
    expect(applyPaidRentalKindsToFit).not.toHaveBeenCalled();
  });
});

describe("Different person, with gear paid for at checkout", () => {
  it("gives the new diver the pieces their seat paid for", async () => {
    signIn();
    vi.mocked(splitBookingIdentity).mockResolvedValue({
      ok: true,
      seatIds: [BOOKING_ID],
    } as never);
    await redirectedTo(() =>
      splitDiverIdentityAction(SHOP_SLUG, TRIP_ID, form({ fullName: "Tom Marsh" })),
    );
    expect(applyPaidRentalKindsToFit).toHaveBeenCalledWith(expect.anything(), {
      shopId: SHOP_ID,
      bookingId: BOOKING_ID,
    });
  });
});
