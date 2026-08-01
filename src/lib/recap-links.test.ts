import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCapabilityToken } from "./booking-capabilities";
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
    expect(verifyRecapToken(signRecapToken(BOOKING))).toBe(BOOKING);
  });

  it("rejects a tampered signature", () => {
    const token = signRecapToken(BOOKING);
    expect(verifyRecapToken(`${token}x`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyRecapToken("not-a-real-token")).toBeNull();
    expect(verifyRecapToken("")).toBeNull();
  });

  it("refuses a readiness capability token — the two links are not interchangeable", () => {
    // A readiness link (src/db/booking-capabilities.ts) is an unrelated opaque
    // bearer token with no HMAC structure at all, so it must not verify here.
    expect(verifyRecapToken(createCapabilityToken())).toBeNull();
  });

  it("builds an absolute recap path", () => {
    const path = recapLinkPath(BOOKING);
    expect(path.startsWith("/recap/")).toBe(true);
    expect(verifyRecapToken(path.slice("/recap/".length))).toBe(BOOKING);
  });

  it("rejects a token signed with a dedicated RECAP_LINK_SECRET once that secret changes", () => {
    vi.stubEnv("RECAP_LINK_SECRET", "shop-owner-picked-secret-1");
    const token = signRecapToken(BOOKING);
    expect(verifyRecapToken(token)).toBe(BOOKING);

    vi.stubEnv("RECAP_LINK_SECRET", "shop-owner-picked-secret-2");
    expect(verifyRecapToken(token)).toBeNull();
  });

  it("rejects a token minted under the old raw-AUTH_SECRET scheme (pre purpose-separation)", () => {
    // The pre-fix scheme: HMAC directly with the session-JWT secret over
    // "recap:<bookingId>" — no HKDF derivation, no issued-at. AUTH_SECRET's
    // dev fallback is "diveday-dev-secret-not-for-production" (auth.config.ts).
    const payload = Buffer.from(`recap:${BOOKING}`, "utf8").toString("base64url");
    const signature = createHmac("sha256", "diveday-dev-secret-not-for-production")
      .update(payload)
      .digest("base64url");
    expect(verifyRecapToken(`${payload}.${signature}`)).toBeNull();
  });

  it("verifies a fresh token but rejects one past the 180-day window", () => {
    vi.stubEnv("DIVEDAY_CLOCK", "2026-01-01T00:00:00.000Z");
    const token = signRecapToken(BOOKING);

    vi.stubEnv("DIVEDAY_CLOCK", "2026-06-29T00:00:00.000Z"); // 179 days later
    expect(verifyRecapToken(token)).toBe(BOOKING);

    vi.stubEnv("DIVEDAY_CLOCK", "2026-07-02T00:00:00.000Z"); // 182 days later
    expect(verifyRecapToken(token)).toBeNull();
  });
});
