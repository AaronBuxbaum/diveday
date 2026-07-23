import { describe, expect, it } from "vitest";
import { createCapabilityToken } from "./booking-capabilities";
import { recapLinkPath, signRecapToken, verifyRecapToken } from "./recap-links";

const BOOKING = "11111111-2222-3333-4444-555555555555";

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
});
