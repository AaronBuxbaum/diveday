// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PAPER_WAIVER_IDLE } from "@/lib/paper-waiver-form";
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
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const {
  checkInAction,
  confirmIdentityFromCheckIn,
  markNoShowAction,
  markWaiverInPersonFromCheckIn,
  undoCheckInAction,
  undoNoShowAction,
} = await import("./actions");

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
  // The paper-waiver door needs its own attestation; a malformed id must be
  // refused before that is ever read.
  data.set("medicalAttested", "on");
  return data;
}

describe("a malformed booking id at the counter", () => {
  it.each([
    ["checking a diver in", checkInAction],
    ["undoing a check-in", undoCheckInAction],
    ["marking a diver not here", markNoShowAction],
    ["undoing that mark", undoNoShowAction],
    ["confirming a held seat's identity", confirmIdentityFromCheckIn],
  ])("settles %s back on the focused departure instead of erroring", async (_label, action) => {
    signIn();

    const to = await redirectedTo(() => action(SHOP_SLUG, FOCUS_TRIP_ID, bookingForm(NOT_A_UUID)));

    expect(to).toBe(noticeUrl(counterQueuePath(SHOP_SLUG, FOCUS_TRIP_ID), "invalid"));
    expect(getDb).not.toHaveBeenCalled();
  });

  /**
   * **The paper-waiver door is the one that does not navigate** (issue #1674).
   * It answers into the form's own `useActionState` so a refusal can hand the
   * typed values back, so there is no focused-departure path to land on — the
   * form never left the page. The guard itself is the same one: a truncated id
   * is refused before the database is reached.
   */
  it("refuses a paper waiver in the form rather than navigating", async () => {
    signIn();

    const state = await markWaiverInPersonFromCheckIn(
      SHOP_SLUG,
      FOCUS_TRIP_ID,
      PAPER_WAIVER_IDLE,
      bookingForm(NOT_A_UUID),
    );

    expect(state).toMatchObject({ status: "refused", refusal: "error" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses a form with no booking id at all", async () => {
    signIn();

    const to = await redirectedTo(() => checkInAction(SHOP_SLUG, null, new FormData()));

    expect(to).toBe(noticeUrl(counterQueuePath(SHOP_SLUG, null), "invalid"));
    expect(getDb).not.toHaveBeenCalled();
  });
});
