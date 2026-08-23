// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  issueBookingCapability,
  revokeBookingCapabilities,
  staleReadinessBookingForResend,
} from "./booking-capabilities";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import { emailFreshReadinessLink, planReadinessLinkRescue } from "./readiness-link-rescue";
import { bookingCapabilities, people } from "./schema";
import { setTripStatus, upcomingTripsWithCounts } from "./trips";

/**
 * **The rescue a dead trip-prep link offers, and everything it must not do.**
 *
 * A readiness URL *is* its capability, so this action is reachable by whoever
 * holds an expired one — including whoever it leaked to. The tests that matter
 * are therefore the refusals: the caller gets a bare code, the fresh link goes
 * to the address already on the booking, and a live link is never replaced
 * (issue #850).
 */

const APP_ORIGIN = "https://diveday.test";

vi.mock("@/lib/notifications/app-url", () => ({
  publicAppUrl: () => APP_ORIGIN,
}));

const sent = vi.fn();
vi.mock("./notifications", () => ({
  sendAndRecordNotification: (_db: unknown, notification: unknown) => {
    sent(notification);
    return Promise.resolve({ status: "sent", providerMessageId: "test" });
  },
}));

beforeEach(() => sent.mockClear());

async function bookedDiver(db: AppDb, shopId: string, tripId: string, email?: string) {
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: "Nora Quinn",
    email: email ?? "nora@example.com",
  });
  if (!outcome.ok) throw new Error("expected booking to succeed");
  return outcome.bookingId;
}

/** A booking holding one readiness capability that has already been revoked. */
async function bookingWithDeadLink(email?: string) {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("expected a seeded trip");
  const bookingId = await bookedDiver(db, shop.id, trip.id, email);
  const issued = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId,
    purpose: "readiness",
  });
  if (!issued) throw new Error("expected a capability");
  // Revoked rather than aged out: same deadness, no clock to move.
  await revokeBookingCapabilities(db, { shopId: shop.id, bookingId, purpose: "readiness" });
  return { db, shop, bookingId, token: issued.token };
}

describe("emailFreshReadinessLink", () => {
  it("sends a fresh link to the address already on the booking", async () => {
    const { db, bookingId, token } = await bookingWithDeadLink();

    expect(await emailFreshReadinessLink(db, token)).toBe("sent");

    expect(sent).toHaveBeenCalledTimes(1);
    const notification = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(notification.kind).toBe("readiness_link");
    // **To the address on file, and to nothing the caller supplied** — the
    // action takes a token and nothing else, so there is no address to pass.
    expect(notification.to).toBe("nora@example.com");
    expect(notification.bookingId).toBe(bookingId);
    // A real, followable link — and a different one from the dead token, which
    // is the whole point.
    expect(String(notification.readinessUrl)).toMatch(new RegExp(`^${APP_ORIGIN}/ready/`));
    expect(String(notification.readinessUrl)).not.toContain(token);
  });

  it("tells the caller nothing but a code", async () => {
    const { db, token } = await bookingWithDeadLink();
    const outcome = await emailFreshReadinessLink(db, token);
    // The whole return value. No address, no token, no name, no booking — a
    // bearer of a leaked dead URL learns only that a delivery happened.
    expect(outcome).toBe("sent");
    expect(typeof outcome).toBe("string");
  });

  /**
   * The guard that stops a *dead* URL driving a delivery on the live one. It
   * also protects the booking's live-capability cap: issuing retires the oldest
   * live row past `MAX_LIVE_CAPABILITIES_PER_PURPOSE`, so an unguarded rescue
   * loop is a way to push a diver's working link out from under them.
   */
  it("refuses to reissue while the booking still holds a live link", async () => {
    const { db, shop, bookingId, token } = await bookingWithDeadLink();
    await issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "readiness" });

    expect(await emailFreshReadinessLink(db, token)).toBe("current_link_live");
    expect(sent).not.toHaveBeenCalled();
  });

  it("says unavailable for a token that was never ours", async () => {
    const { db } = await bookingWithDeadLink();
    expect(await emailFreshReadinessLink(db, "not-a-real-token")).toBe("unavailable");
    expect(sent).not.toHaveBeenCalled();
  });

  /**
   * A cancelled booking is refused by `issueBookingCapability`, which owns that
   * rule — so a diver who cancelled cannot be mailed a working link to a seat
   * they no longer hold, and nobody holding their old URL can trigger one.
   */
  it("says unavailable once the booking is cancelled", async () => {
    const { db, shop, bookingId, token } = await bookingWithDeadLink();
    await cancelBooking(db, shop.id, bookingId);

    expect(await emailFreshReadinessLink(db, token)).toBe("unavailable");
    expect(sent).not.toHaveBeenCalled();
  });

  it("says no_email when there is no address to send to, and issues nothing", async () => {
    const { db, shop, bookingId, token } = await bookingWithDeadLink();
    await db.update(people).set({ email: null }).where(eq(people.shopId, shop.id));

    expect(await emailFreshReadinessLink(db, token)).toBe("no_email");
    expect(sent).not.toHaveBeenCalled();
    // Checked *before* issuing: a capability nothing can carry would still have
    // spent one of the booking's live slots.
    const live = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, bookingId),
          eq(bookingCapabilities.purpose, "readiness"),
        ),
      );
    expect(live).toHaveLength(1);
  });

  /**
   * The original stale token keeps resolving after a send, which is what lets a
   * diver whose *replacement* has since died ask again — and what makes the
   * live-link guard, rather than a one-shot flag, the thing that bounds it.
   */
  it("lets the same dead link rescue again once its replacement has died too", async () => {
    const { db, shop, bookingId, token } = await bookingWithDeadLink();
    expect(await emailFreshReadinessLink(db, token)).toBe("sent");
    expect(await emailFreshReadinessLink(db, token)).toBe("current_link_live");

    await revokeBookingCapabilities(db, { shopId: shop.id, bookingId, purpose: "readiness" });
    expect(await emailFreshReadinessLink(db, token)).toBe("sent");
  });

  /**
   * **A called-off departure must refuse, not reassure.**
   *
   * `verifyBookingCapability` fails closed on a cancelled trip while
   * `issueBookingCapability` does not, so before this was checked here the
   * dead-link page's rescue answered `current_link_live` — rendered in *success*
   * tone, "you already have a link and it still works" — about a trip that no
   * longer runs, permanently, with no rescue ever possible. And once those
   * capabilities aged out it mailed a fresh link naming the cancelled
   * departure. Found by `security-reviewer` (issue #850).
   */
  it("refuses once the trip is cancelled, rather than pointing at a link that cannot work", async () => {
    const { db, shop, bookingId, token } = await bookingWithDeadLink();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    // The booking's own trip, cancelled the way a blow-out cancels it — the
    // bookings deliberately stay (`setTripStatus`).
    await setTripStatus(db, shop.id, trip.id, "cancelled");

    expect(await emailFreshReadinessLink(db, token)).toBe("unavailable");
    expect(sent).not.toHaveBeenCalled();
    // And it is the same answer whether or not a live capability exists, which
    // is the half that used to read as reassurance.
    await issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "readiness" });
    expect(await emailFreshReadinessLink(db, token)).toBe("unavailable");
    expect(sent).not.toHaveBeenCalled();
  });

  /**
   * **Every refusal has to be reachable without spending the diver's budget.**
   *
   * The action rate-limits *between* the plan and the send, so a refusal that
   * the plan can reach costs nothing. This pins the split rather than the
   * limiter: a plan that comes back `ok: false` is a refusal decided from reads
   * alone, with nothing issued and nothing sent.
   */
  it("decides every refusal before anything is issued or spent", async () => {
    const { db, shop, bookingId, token } = await bookingWithDeadLink();
    await issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "readiness" });

    const plan = await planReadinessLinkRescue(db, token);
    expect(plan).toEqual({ ok: false, reason: "current_link_live" });
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("staleReadinessBookingForResend", () => {
  it("resolves a dead readiness token to its own booking and no other", async () => {
    const { db, shop, bookingId, token } = await bookingWithDeadLink();
    expect(await staleReadinessBookingForResend(db, token)).toEqual({
      shopId: shop.id,
      bookingId,
    });
  });

  /**
   * Purpose-scoped like its sibling: a `confirm` or `claim` token is not a key
   * to the readiness rescue, even though every capability lives in one table.
   */
  it("does not resolve a token issued for a different purpose", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    const bookingId = await bookedDiver(db, shop.id, trip.id);
    const confirm = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "confirm",
    });
    if (!confirm) throw new Error("expected a capability");

    expect(await staleReadinessBookingForResend(db, confirm.token)).toBeNull();
  });
});
