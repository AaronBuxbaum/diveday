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
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { emailFreshWaiverLink } = await import("@/db/waiver-issue");
const { checkRateLimit, RATE_LIMITS } = await import("@/lib/rate-limit");
const { emailFreshWaiverLinkAction } = await import("./actions");

const TOKEN = "stale-token";

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

  it("throttles by IP and by token, keyed on the token itself", async () => {
    vi.mocked(emailFreshWaiverLink).mockResolvedValue("sent");
    await redirectedTo();
    expect(checkRateLimit).toHaveBeenCalledTimes(2);
    const configs = vi.mocked(checkRateLimit).mock.calls.map((call) => call[1]);
    expect(configs).toEqual([RATE_LIMITS.capabilityAction, RATE_LIMITS.waiverLinkResendByToken]);
    // Keys are hashed, never the raw token — assert only that the two nets
    // hash different things, so neither can stand in for the other.
    const keys = vi.mocked(checkRateLimit).mock.calls.map((call) => call[0]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.join(" ")).not.toContain(TOKEN);
  });
});
