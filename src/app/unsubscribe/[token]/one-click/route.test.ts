import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route's own job, isolated from the mutators it calls: throttle first,
 * try the last-minute-list resolver, fall back to the courtesy-email one, and
 * always answer with a bare status — a mail client acting on
 * `List-Unsubscribe-Post` never reads a body. The mutators themselves are
 * covered against a real database in `src/db/last-minute-list.test.ts` and
 * `src/db/courtesy-email.test.ts`.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/db/courtesy-email", () => ({ optOutPersonFromCourtesyEmailByToken: vi.fn() }));
vi.mock("@/db/last-minute-list", () => ({ unsubscribeLastMinuteListEntryByToken: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { optOutPersonFromCourtesyEmailByToken } = await import("@/db/courtesy-email");
const { unsubscribeLastMinuteListEntryByToken } = await import("@/db/last-minute-list");
const { checkRateLimit } = await import("@/lib/rate-limit");
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
  vi.mocked(unsubscribeLastMinuteListEntryByToken).mockResolvedValue(null);
  vi.mocked(optOutPersonFromCourtesyEmailByToken).mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /unsubscribe/[token]/one-click", () => {
  it("unsubscribes a last-minute-list entry and answers 200 with no body", async () => {
    vi.mocked(unsubscribeLastMinuteListEntryByToken).mockResolvedValue({
      shopId: "shop-1",
      entryId: "entry-1",
    } as never);

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
    expect(unsubscribeLastMinuteListEntryByToken).toHaveBeenCalledWith({}, { token: TOKEN });
    expect(optOutPersonFromCourtesyEmailByToken).not.toHaveBeenCalled();
  });

  it("falls back to the courtesy-email opt-out when the token is not a last-minute-list entry", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(optOutPersonFromCourtesyEmailByToken).toHaveBeenCalledWith({}, { token: TOKEN });
  });

  it("still answers 200 for an unrecognized token, since a mail client never reads the body", async () => {
    const response = await post("unknown-token");
    expect(response.status).toBe(200);
  });

  it("answers 429 without touching either mutator when the caller is rate-limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });

    const response = await post();

    expect(response.status).toBe(429);
    expect(unsubscribeLastMinuteListEntryByToken).not.toHaveBeenCalled();
    expect(optOutPersonFromCourtesyEmailByToken).not.toHaveBeenCalled();
  });

  it("is idempotent — a second one-click POST for an already-unsubscribed token still answers 200", async () => {
    await post();
    const response = await post();
    expect(response.status).toBe(200);
    expect(optOutPersonFromCourtesyEmailByToken).toHaveBeenCalledTimes(2);
  });
});
