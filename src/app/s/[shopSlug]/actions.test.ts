// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";

/**
 * **"Can't find your link?" is an anonymous capability-minting endpoint**
 * (issue #723), so its whole security design is one requirement: the response
 * must never vary with whether the address has a booking here. These tests
 * pin that at the level a diver or an attacker can actually observe — the
 * `useActionState` result — not at the level of internal function calls,
 * because a passing internal-call assertion proves nothing about what a
 * client-side enumeration probe would see.
 *
 * `after()` is stubbed to capture its callback rather than run or defer it,
 * so "the response never awaits the send" is proven structurally: the action
 * resolves before the (mocked, permanently-hung) send has even settled, for
 * every outcome alike — matched, unmatched, malformed, or throttled.
 */

const hoisted = vi.hoisted(() => ({ afterTasks: [] as Array<() => unknown> }));

vi.mock("next/server", () => ({
  after: vi.fn((task: () => unknown) => {
    hoisted.afterTasks.push(task);
  }),
}));

const sendFindMyBookingLinks = vi.fn((..._args: unknown[]) => new Promise(() => {}));
vi.mock("@/db/find-my-booking", () => ({ sendFindMyBookingLinks }));

vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
  };
});

const { requestFindMyBookingAction } = await import("./actions");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { createBooking } = await import("@/db/bookings");
const { upcomingTripsWithCounts } = await import("@/db/trips");

beforeEach(() => {
  hoisted.afterTasks.length = 0;
  sendFindMyBookingLinks.mockClear();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});
afterEach(() => vi.restoreAllMocks());

function formWithEmail(email: string): FormData {
  const form = new FormData();
  form.set("email", email);
  return form;
}

async function shopWithBooking() {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("expected a seeded trip");
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!outcome.ok) throw new Error("expected booking to succeed");
  return shop;
}

describe("requestFindMyBookingAction", () => {
  it("returns the identical confirmation for a matched and an unmatched address", async () => {
    const shop = await shopWithBooking();

    const matched = await requestFindMyBookingAction(
      shop.slug,
      {},
      formWithEmail("nora@example.com"),
    );
    const unmatched = await requestFindMyBookingAction(
      shop.slug,
      {},
      formWithEmail("nobody@example.com"),
    );

    expect(matched).toEqual({ success: true });
    expect(unmatched).toEqual({ success: true });
    expect(matched).toEqual(unmatched);
  });

  it("returns the same confirmation for a malformed email, never a distinct error", async () => {
    const shop = await shopWithBooking();
    const result = await requestFindMyBookingAction(shop.slug, {}, formWithEmail("not-an-email"));
    expect(result).toEqual({ success: true });
  });

  it("returns the same confirmation while throttled, doing nothing once deferred", async () => {
    const shop = await shopWithBooking();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });

    const result = await requestFindMyBookingAction(
      shop.slug,
      {},
      formWithEmail("nora@example.com"),
    );

    expect(result).toEqual({ success: true });
    // `after()` is still scheduled — an allowed and a throttled request must
    // cost the same before the response is sent (Finding 3) — but running the
    // deferred callback must not actually reach the send.
    expect(hoisted.afterTasks).toHaveLength(1);
    await hoisted.afterTasks[0]?.();
    expect(sendFindMyBookingLinks).not.toHaveBeenCalled();
  });

  it("never awaits the send — the response resolves before a hung send would", async () => {
    const shop = await shopWithBooking();

    // `sendFindMyBookingLinks` above never resolves. If the action awaited it
    // directly (rather than deferring through `after()`), this call would
    // hang and the test would time out.
    const result = await requestFindMyBookingAction(
      shop.slug,
      {},
      formWithEmail("nora@example.com"),
    );
    expect(result).toEqual({ success: true });
    // The work was scheduled, just never awaited by the response itself.
    expect(hoisted.afterTasks).toHaveLength(1);
  });

  it("reaches the actual send only for a real shop, a well-formed email, and no throttle", async () => {
    const shop = await shopWithBooking();

    await requestFindMyBookingAction(shop.slug, {}, formWithEmail("nora@example.com"));
    expect(hoisted.afterTasks).toHaveLength(1);
    await hoisted.afterTasks[0]?.();
    expect(sendFindMyBookingLinks).toHaveBeenCalledTimes(1);
    hoisted.afterTasks.length = 0;
    sendFindMyBookingLinks.mockClear();

    // A malformed email short-circuits before `after()` is scheduled at all —
    // it costs no DB read either way, the one asymmetry this action keeps
    // (matching `requestPasswordReset`'s own accepted shape).
    await requestFindMyBookingAction(shop.slug, {}, formWithEmail("not-an-email"));
    expect(hoisted.afterTasks).toHaveLength(0);

    // A shop that does not exist still schedules `after()` (same fixed cost),
    // but the deferred callback finds no shop and never reaches the send.
    await requestFindMyBookingAction("no-such-shop", {}, formWithEmail("nora@example.com"));
    expect(hoisted.afterTasks).toHaveLength(1);
    await hoisted.afterTasks[0]?.();
    expect(sendFindMyBookingLinks).not.toHaveBeenCalled();
  });

  it("never renders a link, an email, or a booking detail — the whole return value is one flag", async () => {
    const shop = await shopWithBooking();
    const result = await requestFindMyBookingAction(
      shop.slug,
      {},
      formWithEmail("nora@example.com"),
    );
    expect(Object.keys(result)).toEqual(["success"]);
  });
});
