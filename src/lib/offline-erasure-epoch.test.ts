import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signOfflineErasureEpoch, verifyOfflineErasureEpoch } from "./offline-erasure-epoch";

describe("offline manifest erasure epochs", () => {
  it("authenticates the shop, snapshot id, erasure epoch, and ordering revision", () => {
    const shopId = randomUUID();
    const tripId = randomUUID();
    const snapshotId = randomUUID();
    const token = signOfflineErasureEpoch({
      shopId,
      tripId,
      snapshotId,
      epoch: 4,
      snapshotRevision: 9,
    });

    expect(verifyOfflineErasureEpoch({ token, shopId, tripId, snapshotId })).toBe(4);
    expect(
      verifyOfflineErasureEpoch({ token, shopId: randomUUID(), tripId, snapshotId }),
    ).toBeNull();
    expect(
      verifyOfflineErasureEpoch({ token, shopId, tripId: randomUUID(), snapshotId }),
    ).toBeNull();
    expect(
      verifyOfflineErasureEpoch({ token, shopId, tripId, snapshotId: randomUUID() }),
    ).toBeNull();
    expect(
      verifyOfflineErasureEpoch({
        token: token.replace(".9.", ".10."),
        shopId,
        tripId,
        snapshotId,
      }),
    ).toBeNull();
    expect(
      verifyOfflineErasureEpoch({ token: `${token.slice(0, -1)}x`, shopId, tripId, snapshotId }),
    ).toBeNull();
  });

  it("rejects editable timestamps and malformed epochs as authority", () => {
    const shopId = randomUUID();
    const tripId = randomUUID();
    const snapshotId = randomUUID();
    const token = signOfflineErasureEpoch({
      shopId,
      tripId,
      snapshotId,
      epoch: 0,
      snapshotRevision: 1,
    });

    expect(
      verifyOfflineErasureEpoch({
        token: "99999999999999999999.1.fake",
        shopId,
        tripId,
        snapshotId,
      }),
    ).toBeNull();
    expect(verifyOfflineErasureEpoch({ token: "0.1.fake", shopId, tripId, snapshotId })).toBeNull();
    expect(verifyOfflineErasureEpoch({ token: "0.0.fake", shopId, tripId, snapshotId })).toBeNull();
    // No timestamp enters the verifier; a client cannot turn a stale signed
    // epoch into a current one by editing snapshotSavedAt or occurredAt.
    expect(verifyOfflineErasureEpoch({ token, shopId, tripId, snapshotId })).toBe(0);
  });
});
