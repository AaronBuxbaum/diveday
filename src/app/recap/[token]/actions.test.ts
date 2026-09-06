import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The pulse action's own job**, isolated from the write it wraps: throttle by
 * IP *before* the token is verified, narrow what the form claims, and turn a
 * domain outcome code into the one word the page reads back off the URL.
 *
 * What the write itself does — one live row per booking, withdrawal, the
 * cancelled-booking refusal — is pinned against a real database in
 * `src/db/recap-pulses.test.ts`. What can only be seen here is the *order*: an
 * IP limit that runs after `verifyRecapToken` throttles abuse of a link
 * somebody already has and does nothing at all about somebody spraying guesses
 * at the signature (CR-013), and no database test can tell the two apart.
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
vi.mock("@/db/recap-pulses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/recap-pulses")>();
  return { ...actual, submitRecapPulse: vi.fn() };
});
vi.mock("@/db/people", () => ({ recordDiverOwnLocaleForBooking: vi.fn() }));
vi.mock("@/i18n/request", () => ({
  requestFirstHandLocale: vi.fn(async () => "en-US"),
  requestLocale: vi.fn(async () => "en-US"),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/recap-links", () => ({ verifyRecapToken: vi.fn(() => null) }));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { submitRecapPulse } = await import("@/db/recap-pulses");
const { verifyRecapToken } = await import("@/lib/recap-links");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { submitRecapPulseAction } = await import("./actions");

const TOKEN = "signed-recap-token";
const BOOKING_ID = "0f2a9c1e-1111-4222-8333-444444444444";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

/** Where the action sent the diver, without the redirect's control-flow throw. */
async function redirectedTo(data: FormData): Promise<string> {
  try {
    await submitRecapPulseAction(TOKEN, data);
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
  vi.mocked(submitRecapPulse).mockResolvedValue({ ok: true, withdrawn: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("submitRecapPulseAction", () => {
  it("throttles on IP before it ever verifies the token (CR-013)", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 1_000 });
    expect(await redirectedTo(form([["category", "gear"]]))).toBe(`/recap/${TOKEN}?pulse=error`);
    // The point of the ordering: a refused IP costs nothing and reveals nothing
    // about whether the token was real.
    expect(verifyRecapToken).not.toHaveBeenCalled();
    expect(submitRecapPulse).not.toHaveBeenCalled();
  });

  it("throttles per booking once the token is known good", async () => {
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 1_000 });
    expect(await redirectedTo(form([["category", "gear"]]))).toBe(`/recap/${TOKEN}?pulse=error`);
    expect(submitRecapPulse).not.toHaveBeenCalled();
  });

  it("refuses a token that verifies to nothing", async () => {
    vi.mocked(verifyRecapToken).mockReturnValue(null);
    expect(await redirectedTo(form([["category", "gear"]]))).toBe(`/recap/${TOKEN}?pulse=error`);
    expect(submitRecapPulse).not.toHaveBeenCalled();
  });

  /**
   * The authorization shape this action shares with the review beside it: the
   * booking comes from the signed token, and **nothing** in the form is read as
   * identity. A crafted post naming another shop's trip changes nothing,
   * because those fields are never looked at.
   */
  it("takes the booking from the token and reads no identity out of the form", async () => {
    await redirectedTo(
      form([
        ["category", "gear"],
        ["shopId", "00000000-0000-0000-0000-000000000000"],
        ["tripId", "11111111-1111-1111-1111-111111111111"],
        ["bookingId", "22222222-2222-2222-2222-222222222222"],
        ["note", "The inflator stuck."],
      ]),
    );
    expect(submitRecapPulse).toHaveBeenCalledWith(expect.anything(), {
      bookingId: BOOKING_ID,
      categories: ["gear"],
      note: "The inflator stuck.",
    });
  });

  it("drops every posted value that is not one of the five codes", async () => {
    await redirectedTo(
      form([
        ["category", "constructor"],
        ["category", "boat"],
        ["category", "__proto__"],
      ]),
    );
    expect(submitRecapPulse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ categories: ["boat"] }),
    );
  });

  it("names each outcome in one word, and never renders a sentence", async () => {
    const cases = [
      [{ ok: true, withdrawn: false } as const, "saved"],
      [{ ok: true, withdrawn: true } as const, "withdrawn"],
      [{ ok: false, reason: "empty" } as const, "empty"],
      [{ ok: false, reason: "did_not_dive" } as const, "did_not_dive"],
      [{ ok: false, reason: "not_found" } as const, "error"],
    ] as const;
    for (const [outcome, code] of cases) {
      vi.mocked(submitRecapPulse).mockResolvedValueOnce(outcome);
      expect(await redirectedTo(form([["category", "gear"]]))).toBe(
        `/recap/${TOKEN}?pulse=${code}`,
      );
    }
  });

  it("reports an error rather than throwing when the write itself fails", async () => {
    vi.mocked(submitRecapPulse).mockRejectedValueOnce(new Error("db down"));
    expect(await redirectedTo(form([["category", "gear"]]))).toBe(`/recap/${TOKEN}?pulse=error`);
  });
});
