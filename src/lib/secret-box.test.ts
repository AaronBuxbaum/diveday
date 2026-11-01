import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  keyringOpensStored,
  openSecret,
  openSecretWithKeyring,
  resolveSecretKey,
  type SecretKeyring,
  sealSecret,
  secretKeyFingerprint,
  secretKeyFromEnvironment,
} from "./secret-box";

const key = randomBytes(32);
const base64Key = key.toString("base64");

afterEach(() => vi.unstubAllEnvs());

describe("resolveSecretKey", () => {
  it("uses an injected key even when the environment is malformed", () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "bad");
    expect(resolveSecretKey(key)).toEqual({ status: "ok", key });
  });

  it("keeps explicit null unset even when the environment is valid", () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", base64Key);
    expect(resolveSecretKey(null)).toEqual({ status: "unset" });
  });

  it("rereads and validates the environment on each omitted-key call", () => {
    vi.stubEnv("SECRET_ENCRYPTION_KEY", base64Key);
    expect(resolveSecretKey(undefined)).toEqual({
      status: "ok",
      key: { current: key, previous: null },
    });
    const nextKey = randomBytes(32);
    vi.stubEnv("SECRET_ENCRYPTION_KEY", nextKey.toString("base64"));
    expect(resolveSecretKey(undefined)).toEqual({
      status: "ok",
      key: { current: nextKey, previous: null },
    });
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "bad");
    expect(resolveSecretKey(undefined)).toMatchObject({
      status: "invalid",
      variable: "SECRET_ENCRYPTION_KEY",
    });
  });
});

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
    expect(result).toEqual({ status: "ok", key: { current: key, previous: null } });
  });

  it("treats an absent key as unset, not an error — the channel is simply dormant", () => {
    expect(secretKeyFromEnvironment({}).status).toBe("unset");
    expect(secretKeyFromEnvironment({ SECRET_ENCRYPTION_KEY: "   " }).status).toBe("unset");
  });

  it("names a wrong-length key so a mis-set value is not silently dormant", () => {
    const short = randomBytes(16).toString("base64");
    expect(secretKeyFromEnvironment({ SECRET_ENCRYPTION_KEY: short })).toEqual({
      status: "invalid",
      variable: "SECRET_ENCRYPTION_KEY",
      reason: "wrong_length",
    });
  });

  it("names a value that is not base64 at all", () => {
    expect(secretKeyFromEnvironment({ SECRET_ENCRYPTION_KEY: "!!!!" })).toEqual({
      status: "invalid",
      variable: "SECRET_ENCRYPTION_KEY",
      reason: "not_base64",
    });
  });
});

/**
 * Rotation (row 8 of the 2026-10-13 review): a key swapped in one step leaves
 * every value sealed under the old one unreadable, which for two-factor
 * secrets is a lockout. The previous key opens; only the current one seals.
 */
describe("key rotation", () => {
  const previous = randomBytes(32);
  const rotated = secretKeyFromEnvironment({
    SECRET_ENCRYPTION_KEY: base64Key,
    SECRET_ENCRYPTION_KEY_PREVIOUS: previous.toString("base64"),
  });
  if (rotated.status !== "ok") throw new Error("a rotated keyring reads");
  const keyring = rotated.key;

  it("opens a value sealed under the previous key, and says so", () => {
    const sealed = sealSecret("old-token", previous);
    expect(openSecret(sealed, keyring)).toBe("old-token");
    expect(openSecretWithKeyring(sealed, keyring)).toEqual({
      plaintext: "old-token",
      sealedWithPrevious: true,
    });
  });

  it("seals under the current key only, so dropping the previous key loses nothing new", () => {
    const sealed = sealSecret("new-token", keyring);
    expect(openSecret(sealed, key)).toBe("new-token");
    expect(openSecret(sealed, previous)).toBeNull();
    expect(openSecretWithKeyring(sealed, keyring)?.sealedWithPrevious).toBe(false);
  });

  it("still refuses a value sealed under neither key", () => {
    expect(openSecret(sealSecret("token", randomBytes(32)), keyring)).toBeNull();
  });

  it("ignores a previous key equal to the current one", () => {
    expect(
      secretKeyFromEnvironment({
        SECRET_ENCRYPTION_KEY: base64Key,
        SECRET_ENCRYPTION_KEY_PREVIOUS: base64Key,
      }),
    ).toEqual({ status: "ok", key: { current: key, previous: null } });
  });

  it("names a mis-pasted previous key instead of quietly failing what it should open", () => {
    expect(
      secretKeyFromEnvironment({
        SECRET_ENCRYPTION_KEY: base64Key,
        SECRET_ENCRYPTION_KEY_PREVIOUS: randomBytes(16).toString("base64"),
      }),
    ).toEqual({
      status: "invalid",
      variable: "SECRET_ENCRYPTION_KEY_PREVIOUS",
      reason: "wrong_length",
    });
  });

  it("treats a previous key without a current one as unset: nothing can seal", () => {
    expect(
      secretKeyFromEnvironment({ SECRET_ENCRYPTION_KEY_PREVIOUS: previous.toString("base64") })
        .status,
    ).toBe("unset");
  });
});

/**
 * The deploy's check that the keyring opens what is already stored (issue
 * #2999). A malformed key is refused by `scripts/check-env.mjs`; these are the
 * two well-formed mistakes that would still lock out every two-factor staffer.
 */
describe("keyringOpensStored", () => {
  const old = randomBytes(32);
  const next = randomBytes(32);
  /** One account enrolled under `old`: its secret sealed, its codes hashed. */
  const enrolled = {
    sealed: sealSecret("JBSWY3DPEHPK3PXP", old),
    codesKeyId: secretKeyFingerprint(old),
  };

  it("passes the correct pair after a rotation", () => {
    const keyring: SecretKeyring = { current: next, previous: old };
    expect(keyringOpensStored(keyring, [enrolled])).toEqual({ status: "ok", checked: 1 });
  });

  it("passes an unrotated key, and an account already under the new key", () => {
    expect(keyringOpensStored({ current: old, previous: null }, [enrolled])).toEqual({
      status: "ok",
      checked: 1,
    });
    const moved = {
      sealed: sealSecret("JBSWY3DPEHPK3PXP", next),
      codesKeyId: secretKeyFingerprint(next),
    };
    expect(keyringOpensStored({ current: next, previous: null }, [moved])).toEqual({
      status: "ok",
      checked: 1,
    });
  });

  it("refuses a rotated key deployed without its previous", () => {
    expect(keyringOpensStored({ current: next, previous: null }, [enrolled])).toEqual({
      status: "cannot_open",
      reason: "previous_missing",
      checked: 1,
      lockedOut: 1,
    });
  });

  it("refuses a well-formed but wrong previous key", () => {
    const keyring: SecretKeyring = { current: next, previous: randomBytes(32) };
    expect(keyringOpensStored(keyring, [enrolled])).toEqual({
      status: "cannot_open",
      reason: "keys_do_not_open",
      checked: 1,
      lockedOut: 1,
    });
  });

  it("refuses recovery codes hashed under a key the pair does not hold, though the secret opens", () => {
    // The secret moved at a sign-in; the paper codes stayed under the old key.
    const half = {
      sealed: sealSecret("JBSWY3DPEHPK3PXP", next),
      codesKeyId: secretKeyFingerprint(old),
    };
    expect(keyringOpensStored({ current: next, previous: null }, [half])).toMatchObject({
      status: "cannot_open",
      lockedOut: 1,
    });
  });

  it("does not guess about codes whose key was never recorded, or an empty store", () => {
    const unrecorded = { sealed: sealSecret("JBSWY3DPEHPK3PXP", next), codesKeyId: null };
    expect(keyringOpensStored({ current: next, previous: null }, [unrecorded]).status).toBe("ok");
    expect(keyringOpensStored({ current: next, previous: null }, [])).toEqual({
      status: "ok",
      checked: 0,
    });
  });

  it("counts only the accounts it cannot open", () => {
    const keyring: SecretKeyring = { current: next, previous: null };
    const moved = { sealed: sealSecret("x", next), codesKeyId: secretKeyFingerprint(next) };
    expect(keyringOpensStored(keyring, [moved, enrolled, enrolled])).toMatchObject({
      checked: 3,
      lockedOut: 2,
    });
  });
});
