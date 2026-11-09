import { describe, expect, it } from "vitest";
import { bindSignInToken, openSignInToken } from "./magic-sign-in";

describe("email sign-in binding", () => {
  const token = "a".repeat(43);
  const verifiedAt = new Date("2026-11-09T00:00:00Z");
  it("binds to this exact address and verification epoch", () => {
    const bound = bindSignInToken(token, "owner@example.com", verifiedAt);
    expect(openSignInToken(bound, "owner@example.com", verifiedAt)).toBe(token);
    expect(openSignInToken(bound, "other@example.com", verifiedAt)).toBeNull();
    expect(
      openSignInToken(bound, "owner@example.com", new Date(verifiedAt.getTime() + 1)),
    ).toBeNull();
    expect(openSignInToken(token, "owner@example.com", verifiedAt)).toBeNull();
    expect(openSignInToken(`b${bound.slice(1)}`, "owner@example.com", verifiedAt)).toBeNull();
  });
});
