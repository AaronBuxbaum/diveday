import { describe, expect, it } from "vitest";
import {
  logbookProvider,
  logbookProviderCapabilities,
  requireLogbookDataContract,
} from "./registry";

describe("documented partner adapter boundary", () => {
  it.each(["garmin", "suunto"] as const)(
    "keeps %s beta and refuses undocumented data import",
    (provider) => {
      expect(logbookProvider(provider).id).toBe(provider);
      expect(logbookProviderCapabilities(provider)).toMatchObject({
        beta: true,
        importEnabled: false,
      });
      expect(() => requireLogbookDataContract(provider)).toThrow("documentation_required");
    },
  );
  it.each(["__proto__", "constructor", "https://example.com", "GARMIN", "", null, undefined, {}])(
    "refuses an untrusted provider: %j",
    (provider) => {
      expect(() => logbookProvider(provider)).toThrow("invalid_input");
      expect(() => logbookProviderCapabilities(provider as never)).toThrow("invalid_input");
    },
  );
  it("distinguishes documented Garmin capabilities from unestablished Suunto ones", () => {
    expect(logbookProviderCapabilities("garmin")).toMatchObject({
      pkceDocumented: true,
      refreshDocumented: true,
      remoteRevocationDocumented: true,
    });
    expect(logbookProviderCapabilities("suunto")).toMatchObject({
      pkceDocumented: false,
      refreshDocumented: false,
      remoteRevocationDocumented: false,
    });
  });
});
