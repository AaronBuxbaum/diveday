import { describe, expect, it } from "vitest";
import { signReadinessToken } from "./readiness-links";
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

  it("refuses a readiness token — the two links are not interchangeable", () => {
    // A readiness token signs the bare booking id with no recap purpose prefix,
    // so it must not verify as a recap token even though the secret is shared.
    expect(verifyRecapToken(signReadinessToken(BOOKING))).toBeNull();
  });

  it("builds an absolute recap path", () => {
    const path = recapLinkPath(BOOKING);
    expect(path.startsWith("/recap/")).toBe(true);
    expect(verifyRecapToken(path.slice("/recap/".length))).toBe(BOOKING);
  });
});
