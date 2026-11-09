import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signEvidence, verifyEvidence } from "./evidence-signing";

const oldKey = "a".repeat(40);
const newKey = "b".repeat(40);
const config = (active: string, keys: Record<string, string>) => ({
  WAIVER_INTEGRITY_KEYS: JSON.stringify({ active, keys }),
});

describe("evidence signing key history", () => {
  it("verifies original evidence after active key rotation without re-sealing", () => {
    const before = config("one", { one: oldKey });
    const after = config("two", { one: oldKey, two: newKey });
    const seal = signEvidence("immutable-fields", before);
    expect(seal).toMatch(/^hmac-sha256:one:[a-f0-9]{64}$/);
    expect(verifyEvidence("immutable-fields", seal, after)).toBe(true);
    expect(signEvidence("immutable-fields", after)).not.toBe(seal);
    expect(verifyEvidence("changed-fields", seal, after)).toBe(false);
  });

  it("binds the key ID into the seal and refuses unknown or removed keys", () => {
    const env = config("one", { one: oldKey, alias: oldKey });
    const seal = signEvidence("fields", env);
    expect(verifyEvidence("fields", seal.replace(":one:", ":alias:"), env)).toBe(false);
    expect(verifyEvidence("fields", seal, config("two", { two: newKey }))).toBe(false);
  });

  it("preserves historical untagged seals only with an explicitly retained original key", () => {
    const old = { WAIVER_INTEGRITY_SECRET: oldKey };
    const seal = signEvidence("fields", old);
    expect(seal).toBe(createHmac("sha256", oldKey).update("fields").digest("hex"));
    const rotated = config("two", { legacy: oldKey, two: newKey });
    expect(verifyEvidence("fields", seal, rotated)).toBe(true);
    expect(verifyEvidence("fields", seal, { ...rotated, AUTH_SECRET: "rotated-auth" })).toBe(true);
    expect(verifyEvidence("fields", seal, config("two", { two: newKey }))).toBe(false);
  });

  it.each([
    "not-json",
    JSON.stringify({ active: "missing", keys: { one: oldKey } }),
    JSON.stringify({ active: "legacy", keys: { legacy: oldKey } }),
    JSON.stringify({ active: "one", keys: { one: "short" } }),
  ])("fails closed for invalid configuration without fallback: %s", (value) => {
    const env = { WAIVER_INTEGRITY_KEYS: value, AUTH_SECRET: oldKey };
    expect(() => signEvidence("fields", env)).toThrow("evidence_key_config_invalid");
    expect(verifyEvidence("fields", "0".repeat(64), env)).toBe(false);
  });

  it("refuses malformed seal encodings", () => {
    const env = config("one", { one: oldKey });
    for (const seal of ["", "hmac-sha256:one:bad", `hmac-sha256:one:${"0".repeat(65)}`, "00"])
      expect(verifyEvidence("fields", seal, env)).toBe(false);
  });
});
