import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route's own job, isolated from the resolver it calls: throttle first,
 * hand the token to the one resolver, and always answer with a bare status; a
 * mail client acting on `List-Unsubscribe-Post` never reads a body. Which kind
 * a token is, and that exactly that kind is stopped, is covered against a real
 * database in `src/db/unsubscribe.test.ts`.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/db/unsubscribe", () => ({ unsubscribeByToken: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { unsubscribeByToken } = await import("@/db/unsubscribe");
const { checkRateLimit, rateLimitKey, RATE_LIMITS } = await import("@/lib/rate-limit");
const { POST } = await import("./route");

const TOKEN = "tok_abc123";

function post(token = TOKEN) {
  return POST(
    new Request("https://dive.day/unsubscribe/tok_abc123/one-click", { method: "POST" }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(unsubscribeByToken).mockResolvedValue({
    kind: "courtesy",
    shopName: "Shop",
    done: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /unsubscribe/[token]/one-click", () => {
  it("hands the token to the one resolver and answers 200 with no body", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
    expect(unsubscribeByToken).toHaveBeenCalledTimes(1);
    expect(unsubscribeByToken).toHaveBeenCalledWith({}, { token: TOKEN });
  });

  it("still answers 200 for an unrecognized token, since a mail client never reads the body", async () => {
    vi.mocked(unsubscribeByToken).mockResolvedValue(null);

    const response = await post("unknown-token");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
  });

  it("answers 429 without resolving when the caller is rate-limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });

    const response = await post();

    expect(response.status).toBe(429);
    expect(unsubscribeByToken).not.toHaveBeenCalled();
  });

  it("uses a token-scoped bucket separate from the human confirmation action", async () => {
    await post();

    expect(checkRateLimit).toHaveBeenCalledWith(
      rateLimitKey("unsubscribe-one-click", TOKEN),
      RATE_LIMITS.oneClickUnsubscribe,
    );
    expect(checkRateLimit).not.toHaveBeenCalledWith(
      rateLimitKey("unsubscribe-token", "203.0.113.7"),
      RATE_LIMITS.accountTokenAction,
    );
  });

  it("limits by IP as well, before the token's own bucket (third-pass security N3)", async () => {
    vi.mocked(checkRateLimit).mockImplementation(async (key) =>
      key === rateLimitKey("unsubscribe-one-click-ip", "203.0.113.7")
        ? { allowed: false, retryAfterMs: 60_000 }
        : { allowed: true, retryAfterMs: 0 },
    );

    const response = await post("a-fresh-guess");

    expect(response.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith(
      rateLimitKey("unsubscribe-one-click-ip", "203.0.113.7"),
      RATE_LIMITS.oneClickUnsubscribeByIp,
    );
    expect(unsubscribeByToken).not.toHaveBeenCalled();
  });

  it("is idempotent: a second one-click POST for the same token still answers 200", async () => {
    await post();
    const response = await post();
    expect(response.status).toBe(200);
    expect(unsubscribeByToken).toHaveBeenCalledTimes(2);
  });
});
