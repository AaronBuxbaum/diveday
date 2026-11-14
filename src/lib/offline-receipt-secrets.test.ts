import { afterEach, describe, expect, it, vi } from "vitest";
import { authSecret } from "./auth-secret";
import { offlineReceiptSecrets } from "./offline-receipt-secrets";

afterEach(() => vi.unstubAllEnvs());

describe("offline receipt verification keys", () => {
  it("uses the current key first and retains distinct previous keys", () => {
    vi.stubEnv("OFFLINE_PREVIOUS_AUTH_SECRETS", JSON.stringify(["old key", authSecret, "old key"]));
    expect(offlineReceiptSecrets()).toEqual([authSecret, "old key"]);
  });

  it("fails closed for malformed key configuration", () => {
    for (const value of [
      "{",
      JSON.stringify(["valid", ""]),
      JSON.stringify("old key"),
      JSON.stringify(Array(9).fill("key")),
    ]) {
      vi.stubEnv("OFFLINE_PREVIOUS_AUTH_SECRETS", value);
      expect(() => offlineReceiptSecrets()).toThrow("Invalid offline receipt key configuration");
    }
  });
});
