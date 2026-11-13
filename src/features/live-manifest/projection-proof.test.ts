import { describe, expect, it } from "vitest";
import {
  hashManifestProjection,
  signLiveManifestProjection,
  verifyLiveManifestProjection,
} from "./projection-proof";

const binding = {
  shopId: "shop-a",
  tripId: "trip-a",
  checkpoint: "departure",
  sessionHandle: "a".repeat(43),
  nonce: "11111111-1111-4111-8111-111111111111",
  erasureEpoch: 4,
  digest: hashManifestProjection('{"rows":["Nora"]}'),
  issuedAt: 1000,
  expiresAt: 2000,
};

describe("live manifest projection proof", () => {
  it("binds the exact projection, scope, session, epoch, nonce and expiry", () => {
    const proof = signLiveManifestProjection(binding);
    expect(proof).toBeTruthy();
    expect(verifyLiveManifestProjection(binding, proof, 1000)).toBe(true);
    for (const change of [
      { shopId: "shop-b" },
      { tripId: "trip-b" },
      { checkpoint: "after-dive-1" },
      { sessionHandle: "b".repeat(43) },
      { nonce: "22222222-2222-4222-8222-222222222222" },
      { erasureEpoch: 5 },
      { digest: hashManifestProjection('{"rows":["Other"]}') },
      { expiresAt: 2001 },
      { issuedAt: 999 },
    ])
      expect(verifyLiveManifestProjection({ ...binding, ...change }, proof, 1000)).toBe(false);
    expect(verifyLiveManifestProjection(binding, proof, 2000)).toBe(false);
    expect(verifyLiveManifestProjection(binding, proof, 999)).toBe(false);
  });

  it("refuses malformed provenance and proof", () => {
    expect(signLiveManifestProjection({ ...binding, nonce: "bad" })).toBeNull();
    expect(signLiveManifestProjection({ ...binding, erasureEpoch: -1 })).toBeNull();
    expect(signLiveManifestProjection({ ...binding, digest: "bad" })).toBeNull();
    expect(verifyLiveManifestProjection(binding, "bad", 1000)).toBe(false);
    expect(verifyLiveManifestProjection(binding, "a".repeat(100_000), 1000)).toBe(false);
    expect(signLiveManifestProjection({ ...binding, shopId: "x".repeat(129) })).toBeNull();
    expect(verifyLiveManifestProjection(null as never, "a".repeat(43), 1000)).toBe(false);
  });
});
