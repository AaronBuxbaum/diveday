import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route's own job, isolated from the mutators it calls: throttle first,
 * try the last-minute-list resolver, fall back to the courtesy-email one, and
 * always answer with a bare status — a mail client acting on
 * `List-Unsubscribe-Post` never reads a body. The mutators themselves are
 * covered against a real database in `src/db/interest-anytime.test.ts` and
 * `src/db/courtesy-email.test.ts`.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({}) as never) };
});
vi.mock("@/db/courtesy-email", () => ({ optOutPersonFromCourtesyEmailByToken: vi.fn() }));
vi.mock("@/db/interests", () => ({ unsubscribeAnytimeInterestByToken: vi.fn() }));
vi.mock("@/db/weekly-digest", () => ({ turnOffWeeklyDigestByToken: vi.fn() }));
vi.mock("@/db/shore-alert-tokens", () => ({ stopShoreAlertsByToken: vi.fn() }));
vi.mock("@/db/bookkeeper", () => ({ stopBookkeeperByToken: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { optOutPersonFromCourtesyEmailByToken } = await import("@/db/courtesy-email");
const { unsubscribeAnytimeInterestByToken } = await import("@/db/interests");
const { turnOffWeeklyDigestByToken } = await import("@/db/weekly-digest");
const { stopShoreAlertsByToken } = await import("@/db/shore-alert-tokens");
const { stopBookkeeperByToken } = await import("@/db/bookkeeper");
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
  vi.mocked(unsubscribeAnytimeInterestByToken).mockResolvedValue(null);
  vi.mocked(optOutPersonFromCourtesyEmailByToken).mockResolvedValue(null);
  vi.mocked(turnOffWeeklyDigestByToken).mockResolvedValue(null);
  vi.mocked(stopShoreAlertsByToken).mockResolvedValue(null);
  vi.mocked(stopBookkeeperByToken).mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /unsubscribe/[token]/one-click", () => {
  it("unsubscribes a last-minute-list interest and answers 200 with no body", async () => {
    vi.mocked(unsubscribeAnytimeInterestByToken).mockResolvedValue({
      shopId: "shop-1",
      interestId: "interest-1",
    } as never);

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
    expect(unsubscribeAnytimeInterestByToken).toHaveBeenCalledWith({}, { token: TOKEN });
    expect(optOutPersonFromCourtesyEmailByToken).not.toHaveBeenCalled();
  });

  it("falls back to the courtesy-email opt-out when the token is not a last-minute-list interest", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(optOutPersonFromCourtesyEmailByToken).toHaveBeenCalledWith({}, { token: TOKEN });
  });

  it("turns off the Monday email when the token is neither of the diver kinds", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(turnOffWeeklyDigestByToken).toHaveBeenCalledWith({}, { token: TOKEN });
  });

  // H-20261014-stale-roll-call-recipients: a shop's shore contact stops its roll-call alerts from the mail
  // client's own button, tried last.
  it("stops a shore contact's roll-call alerts when the token is none of the others", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(stopShoreAlertsByToken).toHaveBeenCalledWith({}, { token: TOKEN });
  });

  // Item 35, second-pass N1: a bookkeeper stops the month-end files, tried last.
  it("stops a bookkeeper's month-end files when the token is none of the others", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(stopBookkeeperByToken).toHaveBeenCalledWith({}, { token: TOKEN });
  });

  it("leaves the bookkeeper alone when a shore-contact token matched", async () => {
    vi.mocked(stopShoreAlertsByToken).mockResolvedValue({
      shopId: "s",
      shopName: "Shop",
      alreadyStopped: true,
    });

    await post();

    expect(stopBookkeeperByToken).not.toHaveBeenCalled();
  });

  it("leaves the shore contact alone when a Monday-email token matched", async () => {
    vi.mocked(turnOffWeeklyDigestByToken).mockResolvedValue({ personId: "p" } as never);

    await post();

    expect(stopShoreAlertsByToken).not.toHaveBeenCalled();
  });

  it("leaves the Monday email alone when a courtesy-email token matched", async () => {
    vi.mocked(optOutPersonFromCourtesyEmailByToken).mockResolvedValue({ personId: "p" } as never);

    await post();

    expect(turnOffWeeklyDigestByToken).not.toHaveBeenCalled();
  });

  it("still answers 200 for an unrecognized token, since a mail client never reads the body", async () => {
    const response = await post("unknown-token");
    expect(response.status).toBe(200);
  });

  it("answers 429 without touching either mutator when the caller is rate-limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });

    const response = await post();

    expect(response.status).toBe(429);
    expect(unsubscribeAnytimeInterestByToken).not.toHaveBeenCalled();
    expect(optOutPersonFromCourtesyEmailByToken).not.toHaveBeenCalled();
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
    expect(unsubscribeAnytimeInterestByToken).not.toHaveBeenCalled();
    expect(stopBookkeeperByToken).not.toHaveBeenCalled();
  });

  it("is idempotent — a second one-click POST for an already-unsubscribed token still answers 200", async () => {
    await post();
    const response = await post();
    expect(response.status).toBe(200);
    expect(optOutPersonFromCourtesyEmailByToken).toHaveBeenCalledTimes(2);
  });
});
