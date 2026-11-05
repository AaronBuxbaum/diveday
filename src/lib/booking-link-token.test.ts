import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bookingLinkKeyring,
  bookingLinkToken,
  decodeCapabilityId,
  encodeCapabilityId,
  parseVerifiedCapabilityToken,
} from "./booking-link-token";

const AUTH = "a".repeat(40);
const V2 = `v2:${"b".repeat(40)}`;
const V3 = `v3:${"c".repeat(40)}`;
const local = { NODE_ENV: "test", AUTH_SECRET: AUTH };
const ring = bookingLinkKeyring(local);

function tokenFor(purpose = "readiness", keyring = ring, id = randomUUID()) {
  return {
    id,
    token: bookingLinkToken({ id, keyVersion: keyring.signingVersion(), purpose }, keyring),
  };
}

/** The same token with one character of its tag changed. */
function flipTag(token: string): string {
  const last = token.at(-2) === "A" ? "B" : "A";
  return `${token.slice(0, -2)}${last}${token.at(-1)}`;
}

describe("booking link tokens", () => {
  it("round-trips: the shape is c<v>.<22>.<43>, and verify returns the row id and version", () => {
    const { id, token } = tokenFor();
    expect(token).toMatch(/^c1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(token).toHaveLength(69);
    expect(parseVerifiedCapabilityToken(token, "readiness", ring)).toEqual({ id, version: 1 });
  });

  it("is a pure function of the row: the same row gives the same token every time", () => {
    const id = randomUUID();
    const row = { id, keyVersion: 1, purpose: "confirm" };
    expect(bookingLinkToken(row, ring)).toBe(bookingLinkToken(row, ring));
  });

  it("refuses a forged tag on a real id", () => {
    const { token } = tokenFor();
    expect(parseVerifiedCapabilityToken(flipTag(token), "readiness", ring)).toBeNull();
  });

  it("refuses the right tag under the wrong purpose, both ways", () => {
    const { token } = tokenFor("confirm");
    expect(parseVerifiedCapabilityToken(token, "readiness", ring)).toBeNull();
    expect(parseVerifiedCapabilityToken(token, "confirm", ring)).not.toBeNull();
    const { token: forms } = tokenFor("course_forms");
    expect(parseVerifiedCapabilityToken(forms, "readiness", ring)).toBeNull();
  });

  it("binds the version into the MAC: relabelling a v2 token as v1 fails", () => {
    const both = bookingLinkKeyring({ ...local, BOOKING_LINK_SECRET: V2 });
    const { token } = tokenFor("readiness", both);
    expect(token.startsWith("c2.")).toBe(true);
    expect(parseVerifiedCapabilityToken(`c1${token.slice(2)}`, "readiness", both)).toBeNull();
  });

  it("refuses unknown versions before any key work: c0, c9 with no key, and c10", () => {
    const { token } = tokenFor();
    expect(parseVerifiedCapabilityToken(`c0${token.slice(2)}`, "readiness", ring)).toBeNull();
    expect(parseVerifiedCapabilityToken(`c9${token.slice(2)}`, "readiness", ring)).toBeNull();
    expect(parseVerifiedCapabilityToken(`c10${token.slice(2)}`, "readiness", ring)).toBeNull();
  });

  it("parses ids canonically: a last id character with spare bits set is refused", () => {
    const { token } = tokenFor();
    const idSegment = token.slice(3, 25);
    const last = idSegment.at(-1) ?? "";
    // The 22nd character holds two data bits and four that must be zero; bump
    // the low bits and the bytes decode the same while the string differs.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const sibling = alphabet[alphabet.indexOf(last) + 1] ?? "";
    const forged = `${token.slice(0, 24)}${sibling}${token.slice(25)}`;
    expect(Buffer.from(forged.slice(3, 25), "base64url")).toEqual(
      Buffer.from(idSegment, "base64url"),
    );
    expect(parseVerifiedCapabilityToken(forged, "readiness", ring)).toBeNull();
    expect(decodeCapabilityId(forged.slice(3, 25))).toBeNull();
  });

  it("encodes and decodes a uuid exactly", () => {
    const id = randomUUID();
    expect(decodeCapabilityId(encodeCapabilityId(id))).toBe(id);
  });

  it.each([
    ["empty", ""],
    ["a trailing /forms", `${tokenFor().token}/forms`],
    ["multibyte at the right length", `c1.${"é".repeat(22)}.${"a".repeat(43)}`],
    ["an emoji tag", `c1.${"A".repeat(22)}.${"😀".repeat(21)}a`],
    ["the old 43-character random token", "a".repeat(43)],
    ["a non-string", 42],
    ["null", null],
  ])("refuses %s without throwing", (_label, input) => {
    expect(() => parseVerifiedCapabilityToken(input, "readiness", ring)).not.toThrow();
    expect(parseVerifiedCapabilityToken(input, "readiness", ring)).toBeNull();
  });
});

describe("booking link keys", () => {
  it("signs under v1 from AUTH_SECRET while BOOKING_LINK_SECRET is unset", () => {
    expect(ring.signingVersion()).toBe(1);
  });

  it("signs under BOOKING_LINK_SECRET's own version once it is set, and v1 rows still verify", () => {
    const v1 = tokenFor();
    const both = bookingLinkKeyring({ ...local, BOOKING_LINK_SECRET: V2 });
    expect(both.signingVersion()).toBe(2);
    expect(parseVerifiedCapabilityToken(v1.token, "readiness", both)).toEqual({
      id: v1.id,
      version: 1,
    });
  });

  it("rotates: the previous value keeps verifying, the new one signs", () => {
    const before = bookingLinkKeyring({ ...local, BOOKING_LINK_SECRET: V2 });
    const old = tokenFor("readiness", before);
    const after = bookingLinkKeyring({
      ...local,
      BOOKING_LINK_SECRET: V3,
      BOOKING_LINK_SECRET_PREVIOUS: V2,
    });
    expect(after.signingVersion()).toBe(3);
    expect(parseVerifiedCapabilityToken(old.token, "readiness", after)?.id).toBe(old.id);
    // Without the previous value, that version's links are dead at once.
    const cut = bookingLinkKeyring({ ...local, BOOKING_LINK_SECRET: V3 });
    expect(parseVerifiedCapabilityToken(old.token, "readiness", cut)).toBeNull();
  });

  it("retires v1 at the first rotation: with BOOKING_LINK_SECRET_PREVIOUS set, v1 no longer verifies", () => {
    const v1 = tokenFor();
    const rotated = bookingLinkKeyring({
      ...local,
      BOOKING_LINK_SECRET: V3,
      BOOKING_LINK_SECRET_PREVIOUS: V2,
    });
    expect(rotated.keyFor(1)).toBeNull();
    expect(parseVerifiedCapabilityToken(v1.token, "readiness", rotated)).toBeNull();
    // A previous value with no current one changes nothing: v1 still signs.
    const stray = bookingLinkKeyring({ ...local, BOOKING_LINK_SECRET_PREVIOUS: V2 });
    expect(stray.signingVersion()).toBe(1);
  });

  it("refuses a BOOKING_LINK_SECRET whose secret is AUTH_SECRET itself", () => {
    for (const env of [
      { BOOKING_LINK_SECRET: `v2:${AUTH}` },
      { BOOKING_LINK_SECRET: V3, BOOKING_LINK_SECRET_PREVIOUS: `v2:${AUTH}` },
    ]) {
      expect(() => bookingLinkKeyring({ ...local, ...env }).signingVersion()).toThrow();
    }
  });

  it("never verifies a key moved under a different version", () => {
    const signer = bookingLinkKeyring({ ...local, BOOKING_LINK_SECRET: V2 });
    const old = tokenFor("readiness", signer);
    // The same secret, relabelled v3, is a different key.
    const relabelled = bookingLinkKeyring({
      ...local,
      BOOKING_LINK_SECRET: `v3:${"b".repeat(40)}`,
    });
    expect(
      parseVerifiedCapabilityToken(`c3${old.token.slice(2)}`, "readiness", relabelled),
    ).toBeNull();
  });

  it.each([
    ["short", `v2:${"x".repeat(31)}`],
    ["unversioned", "y".repeat(40)],
    ["version 1", `v1:${"z".repeat(40)}`],
  ])("refuses a %s BOOKING_LINK_SECRET loudly when signing", (_label, value) => {
    const bad = bookingLinkKeyring({ ...local, BOOKING_LINK_SECRET: value });
    expect(() => bad.signingVersion()).toThrow();
    // Old v1 rows still verify; nothing silently signs under v1 instead.
    const v1 = tokenFor();
    expect(parseVerifiedCapabilityToken(v1.token, "readiness", bad)?.id).toBe(v1.id);
  });

  it("refuses a previous key that is not older than the current one", () => {
    const bad = bookingLinkKeyring({
      ...local,
      BOOKING_LINK_SECRET: V2,
      BOOKING_LINK_SECRET_PREVIOUS: V3,
    });
    expect(() => bad.signingVersion()).toThrow();
  });

  it("refuses an AUTH_SECRET under 32 bytes", () => {
    const short = bookingLinkKeyring({ NODE_ENV: "test", AUTH_SECRET: "x".repeat(31) });
    expect(() => short.signingVersion()).toThrow();
    expect(short.keyFor(1)).toBeNull();
    expect(bookingLinkKeyring({ NODE_ENV: "test", AUTH_SECRET: "" }).keyFor(1)).toBeNull();
  });

  it("uses the development fallback only where nothing could be production", () => {
    expect(bookingLinkKeyring({ NODE_ENV: "development" }).keyFor(1)).not.toBeNull();
    expect(
      bookingLinkKeyring({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://u@localhost/db",
      }).keyFor(1),
    ).not.toBeNull();
    const dev = "diveday-dev-secret-not-for-production";
    for (const env of [
      { NODE_ENV: "production", AUTH_SECRET: dev },
      { NODE_ENV: "development", VERCEL_ENV: "preview" },
      { NODE_ENV: "development", DATABASE_URL: "postgres://u@db.neon.tech/db" },
      { NODE_ENV: "development", DATABASE_URL: "not a url" },
      { NODE_ENV: "production" },
    ]) {
      const keyring = bookingLinkKeyring(env);
      expect(keyring.keyFor(1)).toBeNull();
      expect(() => keyring.signingVersion()).toThrow();
    }
  });

  it("fails verification closed, without throwing, when no key is configured", () => {
    const { token } = tokenFor();
    const none = bookingLinkKeyring({ NODE_ENV: "production" });
    expect(() => parseVerifiedCapabilityToken(token, "readiness", none)).not.toThrow();
    expect(parseVerifiedCapabilityToken(token, "readiness", none)).toBeNull();
  });
});
