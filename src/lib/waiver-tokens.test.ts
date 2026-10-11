import { describe, expect, it } from "vitest";
import { createWaiverToken, hashWaiverToken } from "./waiver-tokens";

describe("a waiver link's bearer token", () => {
  it("is 32 random bytes, URL-safe, and different every time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createWaiverToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("is stored only as a SHA-256 digest that never contains the token", () => {
    const token = createWaiverToken();
    const hash = hashWaiverToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashWaiverToken(token)).toBe(hash);
  });

  it("hashes a tampered token to a different record", () => {
    const token = createWaiverToken();
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(hashWaiverToken(`${token.slice(0, -1)}${last}`)).not.toBe(hashWaiverToken(token));
    expect(hashWaiverToken(`${token} `)).not.toBe(hashWaiverToken(token));
    expect(hashWaiverToken(token.toUpperCase())).not.toBe(hashWaiverToken(token));
  });
});
