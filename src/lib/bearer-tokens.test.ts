import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBearerToken, hashBearerToken } from "./bearer-tokens";

/**
 * The two promises the module makes — enough entropy that a token cannot be
 * guessed, and a stored form a database reader cannot replay — are the only
 * things pinned here. Lifetime is deliberately each caller's own.
 */
describe("createBearerToken", () => {
  it("is 256 bits, base64url, so it survives a URL path segment untouched", () => {
    const token = createBearerToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 500 }, createBearerToken));
    expect(tokens.size).toBe(500);
  });
});

describe("hashBearerToken", () => {
  it("is a plain hex SHA-256 of the token, deterministic and unkeyed", () => {
    const token = createBearerToken();
    const digest = hashBearerToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBearerToken(token)).toBe(digest);
    expect(digest).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("stores nothing the token can be read back from", () => {
    const token = createBearerToken();
    const digest = hashBearerToken(token);
    expect(digest).not.toBe(token);
    expect(digest).not.toContain(token);
    expect(hashBearerToken(`${token}x`)).not.toBe(digest);
  });

  it("is case- and whitespace-sensitive, so a mangled link does not verify", () => {
    const token = createBearerToken();
    expect(hashBearerToken(token.toUpperCase())).not.toBe(hashBearerToken(token));
    expect(hashBearerToken(` ${token}`)).not.toBe(hashBearerToken(token));
  });
});
