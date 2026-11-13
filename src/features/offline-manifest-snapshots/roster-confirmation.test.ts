import { describe, expect, it, vi } from "vitest";
import {
  signRosterConfirmation,
  signRosterHistoryScope,
  verifyRosterConfirmation,
} from "./roster-confirmation";

const binding = {
  shopId: "shop-one",
  tripId: "11111111-1111-4111-8111-111111111111",
  sessionId: "session-one",
  nonce: "22222222-2222-4222-8222-222222222222",
  renderId: "33333333-3333-4333-8333-333333333333",
  erasureEpoch: 4,
  checkpoint: "departure",
  readCompletedAt: 1_794_581_040_000,
};

describe("roster confirmation proof", () => {
  it("accepts only the original session, shop, trip, request and render", () => {
    const proof = signRosterConfirmation(binding);
    if (!proof) throw new Error("proof was not signed");
    expect(verifyRosterConfirmation(binding, proof)).toBe(true);
    for (const changed of [
      { shopId: "other-shop" },
      { tripId: "44444444-4444-4444-8444-444444444444" },
      { sessionId: "replacement-session" },
      { nonce: "55555555-5555-4555-8555-555555555555" },
      { renderId: "66666666-6666-4666-8666-666666666666" },
      { erasureEpoch: 5 },
      { checkpoint: "after_dive_1" },
    ]) {
      expect(verifyRosterConfirmation({ ...binding, ...changed }, proof)).toBe(false);
    }
  });

  it("binds the completed read time to the verified render", () => {
    const timed = { ...binding, readCompletedAt: 1_794_581_040_000 };
    const proof = signRosterConfirmation(timed);
    if (!proof) throw new Error("proof was not signed");
    expect(
      verifyRosterConfirmation({ ...timed, readCompletedAt: timed.readCompletedAt + 1 }, proof),
    ).toBe(false);
  });

  it("keeps historical labels scoped to the authenticated session and roster", () => {
    const scope = signRosterHistoryScope(binding);
    expect(scope).toBeTruthy();
    expect(scope).not.toContain(binding.sessionId);
    for (const changed of [
      { shopId: "other" },
      { tripId: "other" },
      { sessionId: "other" },
      { checkpoint: "after_dive_1" },
    ]) {
      expect(signRosterHistoryScope({ ...binding, ...changed })).not.toBe(scope);
    }
    expect(signRosterHistoryScope({ ...binding, sessionId: "" })).toBeNull();
  });

  it("fails closed for missing session, malformed ids and malformed proofs", () => {
    expect(signRosterConfirmation({ ...binding, sessionId: "" })).toBeNull();
    expect(signRosterConfirmation({ ...binding, nonce: "bad" })).toBeNull();
    expect(signRosterConfirmation({ ...binding, renderId: "bad" })).toBeNull();
    expect(signRosterConfirmation({ ...binding, erasureEpoch: -1 })).toBeNull();
    expect(signRosterConfirmation({ ...binding, erasureEpoch: 0.5 })).toBeNull();
    expect(signRosterConfirmation({ ...binding, checkpoint: "after_dive_0" })).toBeNull();
    expect(signRosterConfirmation({ ...binding, readCompletedAt: -1 })).toBeNull();
    expect(signRosterConfirmation({ ...binding, readCompletedAt: 0.5 })).toBeNull();
    expect(
      signRosterConfirmation({ ...binding, readCompletedAt: 8_640_000_000_000_001 }),
    ).toBeNull();
    expect(verifyRosterConfirmation(binding, "")).toBe(false);
    expect(verifyRosterConfirmation(binding, "a".repeat(257))).toBe(false);
    expect(verifyRosterConfirmation(binding, "not-a-matching-proof")).toBe(false);
  });

  it("refuses to sign or verify when the server secret is unavailable", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth-secret", () => ({ authSecret: undefined }));
    try {
      const withoutSecret = await import("./roster-confirmation");
      expect(withoutSecret.signRosterConfirmation(binding)).toBeNull();
      expect(withoutSecret.verifyRosterConfirmation(binding, "valid-shaped-proof")).toBe(false);
    } finally {
      vi.doUnmock("@/lib/auth-secret");
      vi.resetModules();
    }
  });
});
