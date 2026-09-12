import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The kiosk action's own job**, isolated from the lookup it wraps: spend the
 * per-caller bucket *before* the display token is verified, spend the per-link
 * bucket only after, and answer every refusal with the one card.
 *
 * What the lookup itself does — the name match, one-or-none, the arrival write
 * — is pinned against a real database in `src/db/kiosk-check-in.test.ts`. What
 * can only be seen here is the *order* (issue #1609): an IP limit spent after
 * `verifyDisplayToken` throttles abuse of a link somebody already holds and
 * does nothing at all about somebody spraying guesses at the signature, and no
 * database test can tell those two apart.
 */

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({}) as never) }));
vi.mock("@/db/display-tokens", () => ({ verifyDisplayToken: vi.fn(async () => null) }));
vi.mock("@/db/shops", () => ({ getShopById: vi.fn(async () => null) }));
vi.mock("@/db/kiosk-check-in", () => ({ findKioskSeats: vi.fn(async () => []) }));
vi.mock("@/db/check-in", () => ({ checkInAtKiosk: vi.fn(async () => ({ ok: false })) }));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});
vi.mock("@/lib/kiosk-check-in", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kiosk-check-in")>();
  // The floor's arithmetic is pinned in `src/lib/kiosk-check-in.test.ts`; what
  // this file needs from it is only that a refusal reaches it at all. Held to
  // zero rather than slept through, because 750ms of real wall clock per case
  // is a cost a unit suite should not pay to learn something a spy says.
  return { ...actual, kioskResponseWaitMs: vi.fn(() => 0) };
});

const { verifyDisplayToken } = await import("@/db/display-tokens");
const { getShopById } = await import("@/db/shops");
const { findKioskSeats } = await import("@/db/kiosk-check-in");
const { checkRateLimit, RATE_LIMITS, rateLimitKey } = await import("@/lib/rate-limit");
const { kioskResponseWaitMs } = await import("@/lib/kiosk-check-in");
const { kioskCheckInAction } = await import("./actions");

const TOKEN = "a-display-link-token";
const DISPLAY = { id: "3f1b7c22-0000-4000-8000-000000000001", shopId: "shop-1", showNames: false };
const SHOP = { id: "shop-1", defaultLocale: "en-US", timezone: "UTC" };

/** The one card the surface answers every refusal with. */
const DESK = {
  status: "desk",
  heading: "See the desk",
  body: "Someone at the counter will take it from here.",
};

function form(who: string): FormData {
  const data = new FormData();
  data.append("who", who);
  return data;
}

/** Every net open, and a token that resolves to a real shop. */
function workingLink() {
  vi.mocked(verifyDisplayToken).mockResolvedValue(DISPLAY as never);
  vi.mocked(getShopById).mockResolvedValue(SHOP as never);
}

/** Refuses the named policy and allows every other. */
function refuse(policy: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS]) {
  vi.mocked(checkRateLimit).mockImplementation(async (_key, config) =>
    config === policy
      ? { allowed: false, retryAfterMs: 1_000 }
      : { allowed: true, retryAfterMs: 0 },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(verifyDisplayToken).mockResolvedValue(null);
  // `getShopById`'s declared return is non-nullable (the row destructure is not
  // index-checked), but it really does answer null for a shop that is not
  // there — which is the state a token this action cannot resolve leaves.
  vi.mocked(getShopById).mockResolvedValue(null as never);
  vi.mocked(findKioskSeats).mockResolvedValue([]);
});

describe("kioskCheckInAction — the per-caller net", () => {
  it("spends the IP bucket before the token is verified, so a guess at the link is not free", async () => {
    await kioskCheckInAction(TOKEN, DESK as never, form("Nwosu"));

    expect(checkRateLimit).toHaveBeenCalledWith(
      rateLimitKey("kiosk-ip", "203.0.113.7"),
      RATE_LIMITS.kioskLookupByIp,
    );
    // The token never resolved, and the bucket was spent anyway. That is the
    // whole of #1609's first half: before this, an unresolvable token cost a
    // database read and no budget at all.
    expect(verifyDisplayToken).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkRateLimit).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(verifyDisplayToken).mock.invocationCallOrder[0] as number,
    );
  });

  it("skips the lookup entirely once the caller's bucket is empty", async () => {
    workingLink();
    refuse(RATE_LIMITS.kioskLookupByIp);

    const result = await kioskCheckInAction(TOKEN, DESK as never, form("Nwosu"));

    expect(result).toEqual(DESK);
    // A spray is now cheaper for us than for whoever is sending it: the
    // refusal costs one bucket read and reaches no table.
    expect(verifyDisplayToken).not.toHaveBeenCalled();
    expect(getShopById).not.toHaveBeenCalled();
    expect(findKioskSeats).not.toHaveBeenCalled();
  });

  it("answers a spent bucket in the same words as an unknown link", async () => {
    const unknown = await kioskCheckInAction(TOKEN, DESK as never, form("Nwosu"));

    workingLink();
    refuse(RATE_LIMITS.kioskLookupByIp);
    const throttled = await kioskCheckInAction(TOKEN, DESK as never, form("Nwosu"));

    // Nothing in the answer distinguishes "this link is not ours" from "you
    // have asked too often" — naming the limiter here would make it an oracle
    // for whether a guessed token is live.
    expect(throttled).toEqual(unknown);
  });

  it("holds a throttled answer to the same floor as every other, rather than returning early", async () => {
    workingLink();
    refuse(RATE_LIMITS.kioskLookupByIp);

    await kioskCheckInAction(TOKEN, DESK as never, form("Nwosu"));

    // The refusal is raised inside `answerKioskSubmission`, never in the timing
    // wrapper. Raised outside it, a refusal would come back instantly and
    // re-open the side channel issue #1608 closed: response time would say
    // which refusal this was.
    expect(kioskResponseWaitMs).toHaveBeenCalledTimes(1);
  });
});

describe("kioskCheckInAction — the per-link net", () => {
  it("still keys on the resolved display, and only after verification", async () => {
    workingLink();

    await kioskCheckInAction(TOKEN, DESK as never, form("Nwosu"));

    expect(checkRateLimit).toHaveBeenCalledWith(
      rateLimitKey("kiosk-lookup", DISPLAY.id),
      RATE_LIMITS.kioskLookup,
    );
    expect(vi.mocked(verifyDisplayToken).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(checkRateLimit).mock.invocationCallOrder[1] as number,
    );
  });

  it("refuses without reading a name when the link's own bucket is empty", async () => {
    workingLink();
    refuse(RATE_LIMITS.kioskLookup);

    const result = await kioskCheckInAction(TOKEN, DESK as never, form("Nwosu"));

    expect(result).toEqual(DESK);
    expect(findKioskSeats).not.toHaveBeenCalled();
  });

  it("lets a real tap through both nets to the lookup", async () => {
    workingLink();

    await kioskCheckInAction(TOKEN, DESK as never, form("Nwosu"));

    expect(findKioskSeats).toHaveBeenCalledTimes(1);
  });
});
