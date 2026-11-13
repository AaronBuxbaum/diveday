import { describe, expect, it } from "vitest";
import { signLiveManifestRecovery, verifyLiveManifestRecovery } from "./recovery-proof";

const binding = {
  shopId: "shop-a",
  sessionHandle: "a".repeat(43),
  tombstone: "11111111-1111-4111-8111-111111111111",
  nonce: "22222222-2222-4222-8222-222222222222",
  erasureEpoch: 4,
  issuedAt: 1000,
  expiresAt: 2000,
};

describe("live manifest erasure recovery proof", () => {
  it("binds the current recovery attempt, staff session and erasure epoch", () => {
    const proof = signLiveManifestRecovery(binding);
    expect(proof).toBeTruthy();
    expect(verifyLiveManifestRecovery(binding, proof, 1000)).toBe(true);
    for (const change of [
      { shopId: "shop-b" },
      { sessionHandle: "b".repeat(43) },
      { tombstone: "33333333-3333-4333-8333-333333333333" },
      { nonce: "44444444-4444-4444-8444-444444444444" },
      { erasureEpoch: 5 },
      { issuedAt: 999 },
      { expiresAt: 2001 },
    ])
      expect(verifyLiveManifestRecovery({ ...binding, ...change }, proof, 1000)).toBe(false);
    expect(verifyLiveManifestRecovery(binding, proof, 2000)).toBe(false);
  });

  it("rejects malformed recovery provenance", () => {
    expect(signLiveManifestRecovery({ ...binding, tombstone: "bad" })).toBeNull();
    expect(signLiveManifestRecovery({ ...binding, nonce: "bad" })).toBeNull();
    expect(signLiveManifestRecovery({ ...binding, erasureEpoch: -1 })).toBeNull();
    expect(verifyLiveManifestRecovery(binding, "bad", 1000)).toBe(false);
    expect(verifyLiveManifestRecovery(binding, "a".repeat(100_000), 1000)).toBe(false);
    expect(signLiveManifestRecovery({ ...binding, shopId: "x".repeat(129) })).toBeNull();
    expect(verifyLiveManifestRecovery(null as never, "a".repeat(43), 1000)).toBe(false);
  });
});
