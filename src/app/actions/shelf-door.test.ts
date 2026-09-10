import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The recap's shelf door, and the two properties that make it safe to put on
 * a link people forward.**
 *
 * A recap link is signed for 180 days, cannot be revoked, and the page it sits
 * on offers "share with a buddy" — so the bearer is not reliably the diver. The
 * door mails the address on the booking, which means the two things worth
 * pinning are that it is **throttled** and that it **answers identically**
 * however it went. The send itself is covered against a real database in
 * `src/db/shelf-link-send.test.ts`.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    // The real `redirect` throws to unwind the action; mirroring that keeps the
    // tests honest about the code after a redirect never running.
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => seatQuery as never) };
});
vi.mock("@/db/shelf-link-send", () => ({ sendShelfLink: vi.fn() }));
vi.mock("@/lib/recap-links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/recap-links")>();
  return { ...actual, verifyRecapToken: vi.fn() };
});
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { sendShelfLink } = await import("@/db/shelf-link-send");
const { verifyRecapToken } = await import("@/lib/recap-links");
const { checkRateLimit, RATE_LIMITS } = await import("@/lib/rate-limit");
const { mailShelfFromRecapAction } = await import("./shelf-door");

const TOKEN = "recap-token";
const BOOKING_ID = "0f2a9c1e-1111-4222-8333-444444444444";
const SHOP_ID = "1a2b3c4d-5555-4666-8777-888888888888";
const PERSON_ID = "2b3c4d5e-9999-4aaa-8bbb-cccccccccccc";

/**
 * The seat the action reads, as the smallest thing that satisfies the builder
 * chain it walks. `rows` is what the query resolves to.
 */
let rows: { shopId: string; personId: string }[] = [];
const seatQuery = {
  select: () => seatQuery,
  from: () => seatQuery,
  innerJoin: () => seatQuery,
  where: () => seatQuery,
  limit: async () => rows,
};

/** Where the action sent the reader, without the redirect's control-flow throw. */
async function redirectedTo(token = TOKEN): Promise<string> {
  try {
    await mailShelfFromRecapAction(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(verifyRecapToken).mockReturnValue(BOOKING_ID);
  vi.mocked(sendShelfLink).mockResolvedValue("sent");
  rows = [{ shopId: SHOP_ID, personId: PERSON_ID }];
});

describe("mailing the shelf link from a recap", () => {
  it("sends to the address on the booking and says so", async () => {
    expect(await redirectedTo()).toBe(`/recap/${TOKEN}?shelf=sent`);
    expect(sendShelfLink).toHaveBeenCalledWith(expect.anything(), {
      shopId: SHOP_ID,
      personId: PERSON_ID,
    });
  });

  it("throttles per booking, on the bucket the runbook names", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });
    expect(await redirectedTo()).toBe(`/recap/${TOKEN}?shelf=sent`);
    // Nothing left the building.
    expect(sendShelfLink).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.any(String),
      RATE_LIMITS.shelfLinkSendByBooking,
    );
  });

  it("never keys the bucket on the raw recap token", async () => {
    await redirectedTo();
    const key = vi.mocked(checkRateLimit).mock.calls[0]?.[0];
    // `rateLimitKey` hashes its parts, so a bearer credential is never held as
    // a literal key or written to a log (CR-013).
    expect(key).not.toContain(TOKEN);
    expect(key).not.toContain(BOOKING_ID);
  });

  /**
   * **The oracle test.** Every one of these is a different fact about the diver
   * — no address on file, a booking that is gone, a provider that refused — and
   * a bearer who could tell them apart could ask a forwarded recap link
   * questions about somebody else's record. One answer, four causes.
   */
  it("answers identically whether or not a mail could go", async () => {
    const happy = await redirectedTo();

    vi.mocked(sendShelfLink).mockResolvedValue("no_email");
    expect(await redirectedTo()).toBe(happy);

    vi.mocked(sendShelfLink).mockResolvedValue("failed");
    expect(await redirectedTo()).toBe(happy);

    vi.mocked(sendShelfLink).mockResolvedValue("unavailable");
    expect(await redirectedTo()).toBe(happy);

    // The booking resolved to nothing at all — an erased diver, a deleted row.
    rows = [];
    expect(await redirectedTo()).toBe(happy);
  });

  /**
   * The one branch that may differ, because it is a fact about the caller's own
   * URL rather than about anybody's record: a signature DiveDay never wrote.
   */
  it("says failed only for a token that never verified", async () => {
    vi.mocked(verifyRecapToken).mockReturnValue(null);
    expect(await redirectedTo("garbage")).toBe("/recap/garbage?shelf=failed");
    expect(sendShelfLink).not.toHaveBeenCalled();
  });
});
