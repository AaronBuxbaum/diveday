import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, sealSecret, secretKeyFromEnvironment } from "./secret-box";

const key = randomBytes(32);
const base64Key = key.toString("base64");

describe("sealSecret / openSecret", () => {
  it("round-trips a credential", () => {
    const sealed = sealSecret("EAAG...shop-access-token", key);
    expect(openSecret(sealed, key)).toBe("EAAG...shop-access-token");
  });

  it("never stores the plaintext in the sealed value", () => {
    const sealed = sealSecret("EAAG...shop-access-token", key);
    expect(sealed).not.toContain("shop-access-token");
    expect(sealed.startsWith("v1.")).toBe(true);
  });

  it("produces different ciphertext each time, so equal tokens are not linkable", () => {
    const first = sealSecret("same-token", key);
    const second = sealSecret("same-token", key);
    expect(first).not.toBe(second);
    expect(openSecret(first, key)).toBe(openSecret(second, key));
  });

  it("round-trips unicode and an empty secret", () => {
    for (const value of ["señor-buceo-🐠", ""]) {
      expect(openSecret(sealSecret(value, key), key)).toBe(value);
    }
  });

  it("refuses to open under a different key", () => {
    const sealed = sealSecret("token", key);
    expect(openSecret(sealed, randomBytes(32))).toBeNull();
  });

  it("refuses a tampered ciphertext rather than returning garbage", () => {
    const sealed = sealSecret("token", key);
    const [scheme, iv, tag, ciphertext] = sealed.split(".");
    const flipped = Buffer.from(ciphertext, "base64url");
    flipped[0] ^= 0xff;
    expect(openSecret([scheme, iv, tag, flipped.toString("base64url")].join("."), key)).toBeNull();
  });

  it("refuses a tampered authentication tag", () => {
    const sealed = sealSecret("token", key);
    const [scheme, iv, tag, ciphertext] = sealed.split(".");
    const flipped = Buffer.from(tag, "base64url");
    flipped[0] ^= 0xff;
    expect(openSecret([scheme, iv, flipped.toString("base64url"), ciphertext].join("."), key)).toBe(
      null,
    );
  });

  it("refuses malformed values and unknown schemes without throwing", () => {
    const sealed = sealSecret("token", key);
    for (const value of ["", "not-sealed", "v1.a.b", `v2.${sealed.slice(3)}`, "v1....."]) {
      expect(openSecret(value, key)).toBeNull();
    }
  });
});

describe("secretKeyFromEnvironment", () => {
  it("reads a 32-byte base64 key", () => {
    const result = secretKeyFromEnvironment({ SECRET_ENCRYPTION_KEY: base64Key });
    expect(result).toEqual({ status: "ok", key });
  });

  it("treats an absent key as unset, not an error — the channel is simply dormant", () => {
    expect(secretKeyFromEnvironment({}).status).toBe("unset");
    expect(secretKeyFromEnvironment({ SECRET_ENCRYPTION_KEY: "   " }).status).toBe("unset");
  });

  it("names a wrong-length key so a mis-set value is not silently dormant", () => {
    const short = randomBytes(16).toString("base64");
    expect(secretKeyFromEnvironment({ SECRET_ENCRYPTION_KEY: short })).toEqual({
      status: "invalid",
      reason: "wrong_length",
    });
  });

  it("names a value that is not base64 at all", () => {
    expect(secretKeyFromEnvironment({ SECRET_ENCRYPTION_KEY: "!!!!" })).toEqual({
      status: "invalid",
      reason: "not_base64",
    });
  });
});
