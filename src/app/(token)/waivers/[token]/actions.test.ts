import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The action's own job, isolated from the send it wraps: throttle first, then
 * turn a domain outcome code into the one-word query value the page reads. The
 * delivery rules themselves are covered against a real database in
 * `src/db/waiver-issue.test.ts`.
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
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/db/waiver-issue", () => ({ emailFreshWaiverLink: vi.fn() }));
vi.mock("@/db/waivers", () => ({ staleWaiverRecordForToken: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { emailFreshWaiverLink } = await import("@/db/waiver-issue");
const { staleWaiverRecordForToken } = await import("@/db/waivers");
const { checkRateLimit, RATE_LIMITS } = await import("@/lib/rate-limit");
const { emailFreshWaiverLinkAction } = await import("./actions");

const TOKEN = "stale-token";
const BOOKING_ID = "0f2a9c1e-1111-4222-8333-444444444444";

/** The stale record a token resolves to — only `bookingId` matters here. */
function staleRecordFor(bookingId: string | null) {
  return { bookingId } as unknown as Awaited<ReturnType<typeof staleWaiverRecordForToken>>;
}

/** Where the action sent the diver, without the redirect's control-flow throw. */
async function redirectedTo(token = TOKEN): Promise<string> {
  try {
    await emailFreshWaiverLinkAction(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(staleWaiverRecordForToken).mockResolvedValue(staleRecordFor(BOOKING_ID));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("emailFreshWaiverLinkAction", () => {
  it("sends the link and confirms it without naming the address", async () => {
    vi.mocked(emailFreshWaiverLink).mockResolvedValue("sent");
    const target = await redirectedTo();
    expect(target).toBe(`/waivers/${TOKEN}?sent=ok`);
    // Only a one-word outcome travels back — no address, no fresh token. The
    // diver returns to the same stale URL they arrived on.
    expect(target).not.toMatch(/@/);
  });

  it.each([
    ["no_email", "none"],
    ["already_signed", "signed"],
    ["current_link_live", "live"],
    ["unavailable", "unavailable"],
    ["failed", "failed"],
  ] as const)("reports %s honestly rather than as a send", async (outcome, param) => {
    vi.mocked(emailFreshWaiverLink).mockResolvedValue(outcome);
    expect(await redirectedTo()).toBe(`/waivers/${TOKEN}?sent=${param}`);
  });

  it("refuses without sending when the per-IP bucket is empty", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 });
    expect(await redirectedTo()).toBe(`/waivers/${TOKEN}?sent=rate`);
    expect(emailFreshWaiverLink).not.toHaveBeenCalled();
  });

  it("refuses when one leaked link has already spent its own bucket", async () => {
    // The second net: the per-token ceiling is what stops a stale URL being
    // used from many addresses to spray one diver's inbox.
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 });
    expect(await redirectedTo()).toBe(`/waivers/${TOKEN}?sent=rate`);
    expect(emailFreshWaiverLink).not.toHaveBeenCalled();
  });

  it("throttles by IP and by the booking behind the link", async () => {
    vi.mocked(emailFreshWaiverLink).mockResolvedValue("sent");
    await redirectedTo();
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    const configs = vi.mocked(checkRateLimit).mock.calls.map((call) => call[1]);
    expect(configs).toEqual([RATE_LIMITS.capabilityAction, RATE_LIMITS.waiverLinkResendByBooking]);
    // Keys are hashed, never the raw token or booking id — assert only that the
    // two nets hash different things, so neither can stand in for the other.
    const keys = vi.mocked(checkRateLimit).mock.calls.map((call) => call[0]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.join(" ")).not.toContain(TOKEN);
    expect(keys.join(" ")).not.toContain(BOOKING_ID);
  });

  it("gives every stale link for one booking a single shared inbox budget", async () => {
    // A booking collects a new dead token on every reissue. Keyed by token,
    // each of those leaked URLs carried its own full 5/hr budget aimed at the
    // same mailbox; keyed by the booking they resolve to, they share one.
    vi.mocked(emailFreshWaiverLink).mockResolvedValue("sent");
    await redirectedTo("stale-token-a");
    const first = vi.mocked(checkRateLimit).mock.calls[1]?.[0];
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
    vi.mocked(staleWaiverRecordForToken).mockResolvedValue(staleRecordFor(BOOKING_ID));
    vi.mocked(emailFreshWaiverLink).mockResolvedValue("sent");
    await redirectedTo("stale-token-b");
    expect(vi.mocked(checkRateLimit).mock.calls[1]?.[0]).toBe(first);
  });

  it("falls back to the token's own bucket when it resolves to no booking", async () => {
    // Nothing resolved means no inbox to protect and no booking to key on. The
    // per-IP net above still applies, and the send itself refuses anyway — but
    // the narrow bucket must never key two unrelated dead tokens together.
    vi.mocked(staleWaiverRecordForToken).mockResolvedValue(null);
    vi.mocked(emailFreshWaiverLink).mockResolvedValue("unavailable");
    await redirectedTo("garbage-a");
    const first = vi.mocked(checkRateLimit).mock.calls[1]?.[0];
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
    vi.mocked(staleWaiverRecordForToken).mockResolvedValue(null);
    vi.mocked(emailFreshWaiverLink).mockResolvedValue("unavailable");
    await redirectedTo("garbage-b");
    expect(vi.mocked(checkRateLimit).mock.calls[1]?.[0]).not.toBe(first);
  });
});
