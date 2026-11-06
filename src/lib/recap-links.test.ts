import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBearerToken } from "./bearer-tokens";
import { recapLinkPath, signRecapToken, verifyRecapToken } from "./recap-links";

const BOOKING = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recap tokens", () => {
  it("round-trips a booking id through sign/verify", () => {
    expect(verifyRecapToken(signRecapToken(BOOKING, 0))).toEqual({ bookingId: BOOKING, epoch: 0 });
  });

  it("rejects a tampered signature", () => {
    const token = signRecapToken(BOOKING, 0);
    expect(verifyRecapToken(`${token}x`)).toBeNull();
  });

  /**
   * **A signature that is not base64url is refused, never thrown at** (security
   * review, finding 3).
   * `timingSafeEqual` compares *bytes* and throws on unequal lengths, so a
   * 43-*character* signature carrying a multibyte character used to reach it
   * and raise `RangeError`, which on a bearer page is a 500 where "this link
   * isn't available" belongs.
   */
  it("refuses a signature of the right length in the wrong alphabet", () => {
    const [payload] = signRecapToken(BOOKING, 0).split(".");
    const multibyte = `${"a".repeat(42)}\u00e9`;
    expect(multibyte).toHaveLength(43);
    expect(() => verifyRecapToken(`${payload}.${multibyte}`)).not.toThrow();
    expect(verifyRecapToken(`${payload}.${multibyte}`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyRecapToken("not-a-real-token")).toBeNull();
    expect(verifyRecapToken("")).toBeNull();
  });

  it("refuses a readiness capability token — the two links are not interchangeable", () => {
    // A readiness link (src/db/booking-capabilities.ts) is an unrelated opaque
    // bearer token with no HMAC structure at all, so it must not verify here.
    expect(verifyRecapToken(createBearerToken())).toBeNull();
  });

  it("carries the epoch it was signed at, and refuses one that is not a whole number", () => {
    expect(verifyRecapToken(signRecapToken(BOOKING, 7))).toEqual({ bookingId: BOOKING, epoch: 7 });
    expect(verifyRecapToken(signRecapToken(BOOKING, -1))).toBeNull();
    expect(verifyRecapToken(signRecapToken(BOOKING, 1.5))).toBeNull();
  });

  it("builds an absolute recap path", () => {
    const path = recapLinkPath(BOOKING, 0);
    expect(path.startsWith("/recap/")).toBe(true);
    expect(verifyRecapToken(path.slice("/recap/".length))).toEqual({
      bookingId: BOOKING,
      epoch: 0,
    });
  });

  it("rejects a token signed with a dedicated RECAP_LINK_SECRET once that secret changes", () => {
    vi.stubEnv("RECAP_LINK_SECRET", "shop-owner-picked-secret-1");
    const token = signRecapToken(BOOKING, 0);
    expect(verifyRecapToken(token)).toEqual({ bookingId: BOOKING, epoch: 0 });

    vi.stubEnv("RECAP_LINK_SECRET", "shop-owner-picked-secret-2");
    expect(verifyRecapToken(token)).toBeNull();
  });

  it("rejects a token minted under the old raw-AUTH_SECRET scheme (pre purpose-separation)", () => {
    // The pre-fix scheme: HMAC directly with the session-JWT secret over
    // "recap:<bookingId>" — no HKDF derivation, no issued-at. AUTH_SECRET's dev
    // fallback is "diveday-dev-secret-not-for-production"
    // (src/lib/auth-secret.ts).
    const payload = Buffer.from(`recap:${BOOKING}`, "utf8").toString("base64url");
    const signature = createHmac("sha256", "diveday-dev-secret-not-for-production")
      .update(payload)
      .digest("base64url");
    expect(verifyRecapToken(`${payload}.${signature}`)).toBeNull();
  });

  it("verifies a fresh token but rejects one past the 180-day window", () => {
    vi.stubEnv("DIVEDAY_CLOCK", "2026-01-01T00:00:00.000Z");
    const token = signRecapToken(BOOKING, 0);

    vi.stubEnv("DIVEDAY_CLOCK", "2026-06-29T00:00:00.000Z"); // 179 days later
    expect(verifyRecapToken(token)).toEqual({ bookingId: BOOKING, epoch: 0 });

    vi.stubEnv("DIVEDAY_CLOCK", "2026-07-02T00:00:00.000Z"); // 182 days later
    expect(verifyRecapToken(token)).toBeNull();
  });
});
