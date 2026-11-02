// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { noticeUrl } from "@/lib/staff-notices";
import { redirectedTo, staffSession } from "@/test/staff-session";
import { counterQueuePath } from "./focus";

/**
 * **A malformed id is a refusal, not a 500** — the counter's copy of the guard
 * `../trips/[id]/actions.ids.test.ts` holds over the roster's actions.
 *
 * Every door on this surface reads `bookingId` off a posted form and spends it
 * in an `eq(bookings.id, …)` clause a few frames later. Postgres does not
 * coerce a bad literal there; it raises `invalid input syntax for type uuid`.
 * Checking the field for *empty* — which is all these actions used to do —
 * catches the missing field and nothing else, so a truncated id from a
 * hand-edited form took the whole queue down at the moment its own `invalid`
 * notice was the answer.
 *
 * The refusal has to land back on the **focused** departure, like every other
 * refusal in this file: the counter is one instrument pointed at one boat
 * (`./focus.ts`), and a notice on the bare queue re-points it at the morning
 * departure while the staffer is working the afternoon one.
 *
 * The database is deliberately unreachable below: `getDb` throws, so an action
 * that lost its guard fails loudly here rather than passing on a bad id.
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
// `requireShopSurface` is the gate these actions take; it stands on
// `requireStaffSession`, which is the seam this file steers. The slug check
// itself is exercised against the real gate in `src/app/shop/[shopSlug]/slug-actions.authz.test.ts`.
vi.mock("@/db/bookings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/bookings")>();
  return { ...actual, getShopBookingTripId: vi.fn() };
});
vi.mock("@/db/check-in", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/check-in")>();
  return { ...actual, checkInBooking: vi.fn() };
});
vi.mock("@/lib/session", () => {
  const requireStaffSession = vi.fn();
  return {
    requireStaffSession,
    requireShopSurface: vi.fn(async () => ({ session: await requireStaffSession() })),
  };
});

const { getDb } = await import("@/db/client");
const { getShopBookingTripId } = await import("@/db/bookings");
const { checkInBooking } = await import("@/db/check-in");
const { requireStaffSession } = await import("@/lib/session");
const { checkInAction, markNoShowAction, turnAwayAction, undoCheckInAction, undoNoShowAction } =
  await import("./actions");

const SHOP_SLUG = "reef-life";
const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const FOCUS_TRIP_ID = "33333333-3333-4333-8333-333333333333";
/** 36 characters of hex and hyphens is still not a uuid — and neither is this. */
const NOT_A_UUID = "44444444-4444-4444-8444-4444444444";

function signIn() {
  vi.mocked(getDb).mockImplementation(() => {
    throw new Error("a refused action must not reach the database");
  });
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: SHOP_ID, shopSlug: SHOP_SLUG, personId: STAFF_ID }),
  );
}

function bookingForm(bookingId: string): FormData {
  const data = new FormData();
  data.set("bookingId", bookingId);
  return data;
}

describe("a malformed booking id at the counter", () => {
  it.each([
    ["checking a diver in", checkInAction],
    ["undoing a check-in", undoCheckInAction],
    ["marking a diver not here", markNoShowAction],
    ["undoing that mark", undoNoShowAction],
  ])("settles %s back on the departure's counter instead of erroring", async (_label, action) => {
    signIn();

    const to = await redirectedTo(() => action(SHOP_SLUG, FOCUS_TRIP_ID, bookingForm(NOT_A_UUID)));

    expect(to).toBe(noticeUrl(counterQueuePath(SHOP_SLUG, FOCUS_TRIP_ID), "invalid"));
    expect(getDb).not.toHaveBeenCalled();
  });

  /**
   * "Turned away" posts a reason beside the seat, and only the enum's own
   * words reach the writer: anything else is the counter's `invalid`, before
   * the database is opened (H-20261015-who-may-turn-someone).
   */
  it.each([
    ["a malformed seat", NOT_A_UUID, "card"],
    ["a reason that is not one", "55555555-5555-4555-8555-555555555555", "asthma"],
    ["no reason at all", "55555555-5555-4555-8555-555555555555", ""],
  ])("settles a turn-away with %s back on the counter", async (_label, bookingId, reason) => {
    signIn();
    const form = bookingForm(bookingId);
    form.set("reason", reason);

    const to = await redirectedTo(() => turnAwayAction(SHOP_SLUG, FOCUS_TRIP_ID, form));

    expect(to).toBe(noticeUrl(counterQueuePath(SHOP_SLUG, FOCUS_TRIP_ID), "invalid"));
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses a form with no booking id at all", async () => {
    signIn();

    const to = await redirectedTo(() => checkInAction(SHOP_SLUG, FOCUS_TRIP_ID, new FormData()));

    expect(to).toBe(noticeUrl(counterQueuePath(SHOP_SLUG, FOCUS_TRIP_ID), "invalid"));
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("a booking that sits on another departure", () => {
  it("is not checked in at this departure's counter", async () => {
    // A well-formed id of the shop's own booking, on another boat: a stale
    // tab. Refused through the roster's shared check (../roster-booking.ts).
    signIn();
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(getShopBookingTripId).mockResolvedValue("66666666-6666-4666-8666-666666666666");

    const to = await redirectedTo(() =>
      checkInAction(SHOP_SLUG, FOCUS_TRIP_ID, bookingForm("55555555-5555-4555-8555-555555555555")),
    );

    expect(to).toBe(noticeUrl(counterQueuePath(SHOP_SLUG, FOCUS_TRIP_ID), "invalid"));
    expect(checkInBooking).not.toHaveBeenCalled();
  });
});
