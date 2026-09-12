// @vitest-environment node
import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { bookings } from "@/db/schema";
import { noticeUrl } from "@/lib/staff-notices";
import { seededShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";
import { counterQueuePath } from "./focus";

/**
 * **The counter's door onto the identity attestation** (H-13, issue #1696).
 *
 * Run against a real seeded database rather than a mocked writer, because the
 * question is not "does the action call something" — it is which of
 * `confirmBookingIdentity`'s two answers the counter turns into which landing,
 * and that answer comes out of the row. The seeded held seat is the one the
 * demo already carries: a night-trip booking that came in through a shared
 * inbox under a name the record disagrees with (`src/db/seed-bookings.ts`).
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
const { revalidatePath } = await import("next/cache");
const { requireStaffSession } = await import("@/lib/session");
const { confirmIdentityFromCheckIn } = await import("./actions");

const FOCUS_TRIP_ID = "33333333-3333-4333-8333-333333333333";

/** The demo's one held seat, with the counter signed in over it. */
async function heldSeatAtTheCounter() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(revalidatePath).mockClear();
  const staffId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: staffId }),
  );
  const [held] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), isNotNull(bookings.identityUnconfirmedAt)))
    .limit(1);
  if (!held) throw new Error("seeded shop has no identity-unconfirmed booking");
  const form = new FormData();
  form.set("bookingId", held.id);
  return { db, shop, bookingId: held.id, form };
}

describe("confirming a held seat's identity from the check-in queue", () => {
  /**
   * The whole point of the change: the flag clears from the counter, so a
   * staffer with a diver in front of them never walks to the trip roster.
   */
  it("clears the flag and answers in place, with no navigation at all", async () => {
    const { db, shop, bookingId, form } = await heldSeatAtTheCounter();

    await expect(
      confirmIdentityFromCheckIn(shop.slug, FOCUS_TRIP_ID, form),
    ).resolves.toBeUndefined();

    const [after] = await db
      .select({ flagged: bookings.identityUnconfirmedAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    expect(after?.flagged).toBeNull();
    // In place, like every other tap on this surface: a redirect would throw
    // away the search that found the diver (issue #1674).
    expect(revalidatePath).toHaveBeenCalledWith(counterQueuePath(shop.slug, FOCUS_TRIP_ID));
  });

  /**
   * **The second tap.** `confirmBookingIdentity` only matches a row whose
   * `identity_unconfirmed_at` is still set, so a double tap — or a row another
   * staffer cleared while this one was reading it — comes back false. The row
   * looks exactly as it did, so this is the one branch with nothing on the page
   * to say it and the only one that navigates.
   */
  it("says so when the seat was no longer held, back on the focused departure", async () => {
    const { shop, form } = await heldSeatAtTheCounter();
    await confirmIdentityFromCheckIn(shop.slug, FOCUS_TRIP_ID, form);

    const to = await redirectedTo(() => confirmIdentityFromCheckIn(shop.slug, FOCUS_TRIP_ID, form));

    expect(to).toBe(noticeUrl(counterQueuePath(shop.slug, FOCUS_TRIP_ID), "identity-not-held"));
  });

  /**
   * Another tenant's booking id is not a seat this counter may vouch for, and
   * the shop scoping lives in `confirmBookingIdentity`'s own `where` — so the
   * action's answer for it is the same "no longer held" the double tap gets,
   * which tells the caller nothing about whether the row exists.
   */
  it("refuses a booking this shop does not hold, saying nothing about it", async () => {
    const { shop } = await heldSeatAtTheCounter();
    const form = new FormData();
    form.set("bookingId", "99999999-9999-4999-8999-999999999999");

    const to = await redirectedTo(() => confirmIdentityFromCheckIn(shop.slug, null, form));

    expect(to).toBe(noticeUrl(counterQueuePath(shop.slug, null), "identity-not-held"));
  });
});
