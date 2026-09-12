// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { redirectedTo, staffSession } from "@/test/staff-session";

/**
 * **A malformed id is a refusal, not a 500.**
 *
 * Every id these actions read arrives as a string — a form field a browser
 * posted, or a path segment bound into the action's arguments — and every one
 * of them lands in an `eq(<uuid column>, …)` clause a few frames later.
 * Postgres does not coerce a bad literal there; it raises `invalid input
 * syntax for type uuid`, so the staffer gets an error page where the notice
 * this action already has is the honest answer (`uuidParam`, src/lib/uuid.ts).
 *
 * The database is deliberately unreachable below: `getDb` throws, so an action
 * that lost its guard fails loudly here rather than passing on a truncated id.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const {
  addToWaitlistAction,
  certifyDiverFromRosterAction,
  confirmDiverIdentityAction,
  removeBookingAction,
  saveCourseNextStepAction,
  undoRemoveBookingAction,
} = await import("./actions");

const SHOP_SLUG = "reef-life";
const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const TRIP_ID = "33333333-3333-4333-8333-333333333333";
const BOOKING_ID = "44444444-4444-4444-8444-444444444444";
/** 36 characters of hex and hyphens is still not a uuid — and neither is this. */
const NOT_A_UUID = "44444444-4444-4444-8444-4444444444";

function signIn() {
  vi.mocked(getDb).mockImplementation(() => {
    throw new Error("a refused action must not reach the database");
  });
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: SHOP_ID, shopSlug: SHOP_SLUG, personId: STAFF_ID }),
  } as never);
}

const tripLanding = (tripId: string) => shopPath(SHOP_SLUG, "trips", tripId);

function bookingForm(bookingId: string): FormData {
  const data = new FormData();
  data.set("bookingId", bookingId);
  return data;
}

describe("a malformed id on the trip roster", () => {
  it.each([
    ["removing a diver", removeBookingAction],
    ["undoing a removal", undoRemoveBookingAction],
    ["confirming a diver's identity", confirmDiverIdentityAction],
    ["saving a course next step", saveCourseNextStepAction],
  ])("settles %s back on the departure instead of erroring", async (_label, action) => {
    signIn();

    const to = await redirectedTo(() => action(SHOP_SLUG, TRIP_ID, bookingForm(NOT_A_UUID)));

    expect(to).toBe(tripLanding(TRIP_ID));
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses a certification award whose diver id is not an id", async () => {
    signIn();
    const data = bookingForm(BOOKING_ID);
    data.set("personId", NOT_A_UUID);
    data.set("award", "advanced_open_water");

    const to = await redirectedTo(() => certifyDiverFromRosterAction(SHOP_SLUG, TRIP_ID, data));

    expect(to).toBe(tripLanding(TRIP_ID));
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses a wait-list join on a departure id that is not an id", async () => {
    // The one here that is not a form field: the departure id is bound into the
    // action's arguments, and `joinTripWaitlist` compares it to `trips.id`
    // inside the transaction that locks the row.
    signIn();
    const data = new FormData();
    data.set("fullName", "Ada Lindqvist");
    data.set("email", "ada@example.invalid");

    const to = await redirectedTo(() => addToWaitlistAction(SHOP_SLUG, NOT_A_UUID, data));

    expect(to).toBe(noticeUrl(tripLanding(NOT_A_UUID), "diver-invalid"));
    expect(getDb).not.toHaveBeenCalled();
  });
});
