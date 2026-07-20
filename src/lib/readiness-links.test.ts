import { describe, expect, it } from "vitest";
import { readinessLinkPath, signReadinessToken, verifyReadinessToken } from "./readiness-links";

const bookingId = "11111111-2222-4333-8444-555555555555";

describe("readiness link tokens", () => {
  it("round-trips a booking id through sign and verify", () => {
    const token = signReadinessToken(bookingId);
    expect(verifyReadinessToken(token)).toBe(bookingId);
  });

  it("is deterministic so staff can re-share the same link", () => {
    expect(signReadinessToken(bookingId)).toBe(signReadinessToken(bookingId));
  });

  it("does not leak the raw booking id in the clear", () => {
    // Opaque enough that the id is not directly readable in the URL.
    expect(signReadinessToken(bookingId)).not.toContain(bookingId);
  });

  it("rejects a tampered signature", () => {
    const token = signReadinessToken(bookingId);
    const tampered = `${token.slice(0, -1)}${token.at(-1) === "a" ? "b" : "a"}`;
    expect(verifyReadinessToken(tampered)).toBeNull();
  });

  it("rejects a swapped payload signed with a different secret", () => {
    const otherId = "99999999-8888-4777-8666-555555555555";
    const forged = `${Buffer.from(otherId, "utf8").toString("base64url")}.${signReadinessToken(bookingId).split(".")[1]}`;
    expect(verifyReadinessToken(forged)).toBeNull();
  });

  it("rejects garbage and empty input", () => {
    expect(verifyReadinessToken("")).toBeNull();
    expect(verifyReadinessToken("nope")).toBeNull();
    expect(verifyReadinessToken(".sig")).toBeNull();
  });

  it("rejects a validly-signed payload that is not a booking uuid", () => {
    const payload = Buffer.from("not-a-uuid", "utf8").toString("base64url");
    // Sign it the same way the module does, via a real token's second half is
    // wrong — instead build a token whose signature matches its own payload.
    const token = signReadinessToken(bookingId);
    // Recompute a matching signature for the bogus payload by trusting the
    // module: sign+verify of a bogus id must fail the uuid gate.
    const bogus = signReadinessToken("not-a-uuid" as string);
    expect(verifyReadinessToken(bogus)).toBeNull();
    // The real token still verifies, proving the gate is specific.
    expect(verifyReadinessToken(token)).toBe(bookingId);
    expect(payload).toBeTruthy();
  });

  it("builds an absolute readiness path", () => {
    expect(readinessLinkPath(bookingId)).toBe(`/ready/${signReadinessToken(bookingId)}`);
  });
});
