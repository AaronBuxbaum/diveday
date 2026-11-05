import { describe, expect, it } from "vitest";
import { bookingLinkKeyring } from "./booking-link-token";
import {
  createWaiverToken,
  hashWaiverToken,
  liveWaiverLinkToken,
  waiverLinkToken,
} from "./waiver-tokens";

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

describe("a derived waiver link", () => {
  const ring = bookingLinkKeyring({ NODE_ENV: "test", AUTH_SECRET: "a".repeat(40) });
  const noKey = bookingLinkKeyring({ NODE_ENV: "production" });

  it("is stable per record, distinct across records, and shaped like a random token", () => {
    const token = waiverLinkToken("rec-1", ring);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(waiverLinkToken("rec-1", ring)).toBe(token);
    expect(waiverLinkToken("rec-2", ring)).not.toBe(token);
  });

  it("falls back to the deployment keyring when none is passed", () => {
    expect(waiverLinkToken("rec-1")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(liveWaiverLinkToken("rec-1", hashWaiverToken(waiverLinkToken("rec-1")))).toBe(
      waiverLinkToken("rec-1"),
    );
  });

  it("refuses to mint when the deployment holds no signing key", () => {
    expect(() => waiverLinkToken("rec-1", noKey)).toThrow();
  });

  it("is found again under the key it was minted with, and under no other record or digest", () => {
    const token = waiverLinkToken("rec-1", ring);
    const digest = hashWaiverToken(token);
    expect(liveWaiverLinkToken("rec-1", digest, ring)).toBe(token);
    expect(liveWaiverLinkToken("rec-2", digest, ring)).toBeNull();
    expect(liveWaiverLinkToken("rec-1", hashWaiverToken("random"), ring)).toBeNull();
  });

  it("is found after a rotation that keeps the old key as previous, and lost once it is dropped", () => {
    const token = waiverLinkToken("rec-1", ring);
    const digest = hashWaiverToken(token);
    const rotated = bookingLinkKeyring({
      NODE_ENV: "test",
      AUTH_SECRET: "a".repeat(40),
      BOOKING_LINK_SECRET: `v3:${"c".repeat(40)}`,
      BOOKING_LINK_SECRET_PREVIOUS: `v2:${"b".repeat(40)}`,
    });
    // v1 is released once a previous key is named, so a v1 link is no longer derivable.
    expect(liveWaiverLinkToken("rec-1", digest, rotated)).toBeNull();
    const underV2 = waiverLinkToken(
      "rec-1",
      bookingLinkKeyring({
        NODE_ENV: "test",
        AUTH_SECRET: "a".repeat(40),
        BOOKING_LINK_SECRET: `v2:${"b".repeat(40)}`,
      }),
    );
    expect(liveWaiverLinkToken("rec-1", hashWaiverToken(underV2), rotated)).toBe(underV2);
  });

  it("refuses to mint when the signing version names a key the keyring does not hold", () => {
    const keyless = { signingVersion: () => 4, keyFor: () => null };
    expect(() => waiverLinkToken("rec-1", keyless)).toThrow("No booking-link key for version 4");
  });

  it("returns null when the keyring holds no key at all", () => {
    expect(liveWaiverLinkToken("rec-1", hashWaiverToken("x"), noKey)).toBeNull();
  });
});
