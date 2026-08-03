import { describe, expect, it } from "vitest";
import { ACTIONABLE_PROVIDER_STATUSES, isActionableProviderStatus } from "./events";

describe("isActionableProviderStatus", () => {
  it.each(ACTIONABLE_PROVIDER_STATUSES)("treats %s as a shop's problem to chase", (status) => {
    expect(isActionableProviderStatus(status)).toBe(true);
  });

  it.each(["sent", "delivered", "delivery_delayed", "suppressed"] as const)(
    "leaves %s off the issue list",
    (status) => {
      expect(isActionableProviderStatus(status)).toBe(false);
    },
  );

  it("is false when nothing has been reported yet", () => {
    expect(isActionableProviderStatus(null)).toBe(false);
  });
});
