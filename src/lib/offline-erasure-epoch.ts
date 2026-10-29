import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-secret";

const signatureShape = /^[A-Za-z0-9_-]{43}$/;
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(
  shopId: string,
  tripId: string,
  snapshotId: string,
  epoch: number,
  snapshotRevision: number,
): string {
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign offline manifest epochs");
  const key = hkdfSync("sha256", authSecret, "", "diveday-offline-manifest-erasure-epoch-v1", 32);
  return createHmac("sha256", Buffer.from(key))
    .update(JSON.stringify([shopId, tripId, snapshotId, epoch, snapshotRevision]))
    .digest("base64url");
}

/** A server-authenticated erasure epoch and ordering revision for one snapshot. */
export function signOfflineErasureEpoch(input: {
  shopId: string;
  tripId: string;
  snapshotId: string;
  epoch: number;
  snapshotRevision: number;
}): string {
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 0) {
    throw new Error("Offline manifest erasure epoch must be a nonnegative safe integer");
  }
  if (!Number.isSafeInteger(input.snapshotRevision) || input.snapshotRevision < 1) {
    throw new Error("Offline manifest snapshot revision must be a positive safe integer");
  }
  const body = `${input.epoch}.${input.snapshotRevision}`;
  return `${body}.${signature(
    input.shopId,
    input.tripId,
    input.snapshotId,
    input.epoch,
    input.snapshotRevision,
  )}`;
}

/** Returns the authenticated epoch, or null for any malformed or forged token. */
export function verifyOfflineErasureEpoch(input: {
  token: string | null | undefined;
  shopId: string;
  tripId: string;
  snapshotId: string | null | undefined;
}): number | null {
  if (!input.token || !input.snapshotId || !uuidShape.test(input.snapshotId)) return null;
  const parts = input.token.split(".");
  if (parts.length !== 3) return null;
  const [epochBody, revisionBody, supplied] = parts;
  if (
    !epochBody ||
    !/^\d{1,16}$/.test(epochBody) ||
    !revisionBody ||
    !/^\d{1,16}$/.test(revisionBody) ||
    !supplied ||
    !signatureShape.test(supplied)
  ) {
    return null;
  }
  const epoch = Number(epochBody);
  const snapshotRevision = Number(revisionBody);
  if (
    !Number.isSafeInteger(epoch) ||
    epoch < 0 ||
    String(epoch) !== epochBody ||
    !Number.isSafeInteger(snapshotRevision) ||
    snapshotRevision < 1 ||
    String(snapshotRevision) !== revisionBody
  ) {
    return null;
  }
  const expected = signature(input.shopId, input.tripId, input.snapshotId, epoch, snapshotRevision);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return null;
  }
  return epoch;
}
