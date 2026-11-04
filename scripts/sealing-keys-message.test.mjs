import { describe, expect, it } from "vitest";
import { sealedSamplesFailureText, sealingKeysFailureText } from "./sealing-keys-message.mjs";

/**
 * The deploy's refusal (`scripts/check-sealing-keys.ts`, issue #2999) names the
 * variables and the two supported ways back, and never a value; there is no
 * bypass flag (security review of #2999).
 */
describe("sealingKeysFailureText", () => {
  it("tells a rotation without its previous key how to recover", () => {
    const text = sealingKeysFailureText({
      reason: "previous_missing",
      checked: 4,
      lockedOut: 3,
    });
    expect(text).toContain("3 of 4 two-factor account(s)");
    expect(text).toContain("set SECRET_ENCRYPTION_KEY_PREVIOUS to the old key");
    expect(text).toContain("turn two-factor off");
    expect(text).toContain("recovery codes");
  });

  it("tells a wrong previous key how to recover", () => {
    const text = sealingKeysFailureText({
      reason: "keys_do_not_open",
      checked: 2,
      lockedOut: 2,
    });
    expect(text).toContain("Neither SECRET_ENCRYPTION_KEY nor SECRET_ENCRYPTION_KEY_PREVIOUS");
    expect(text).toContain("set SECRET_ENCRYPTION_KEY_PREVIOUS to the old key");
    expect(text).toContain("turn two-factor off");
  });
});

describe("sealedSamplesFailureText", () => {
  it("names the kinds and the two ways back, and no shop", () => {
    const text = sealedSamplesFailureText({
      reason: "previous_missing",
      unopened: ["whatsapp", "backup"],
    });
    expect(text).toContain("a WhatsApp access token, a backup destination's access key");
    expect(text).toContain("SECRET_ENCRYPTION_KEY_PREVIOUS is not set");
    expect(text).toContain("set SECRET_ENCRYPTION_KEY_PREVIOUS to the old key");
    expect(text).toContain("reconnect those integrations");
  });

  it("says a wrong previous key is probably wrong", () => {
    const text = sealedSamplesFailureText({
      reason: "keys_do_not_open",
      unopened: ["connector"],
    });
    expect(text).toContain("Neither SECRET_ENCRYPTION_KEY nor SECRET_ENCRYPTION_KEY_PREVIOUS");
    expect(text).toContain("a connector's credentials");
  });
});
