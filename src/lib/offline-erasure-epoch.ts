import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-secret";

const signatureShape = /^[A-Za-z0-9_-]{43}$/;
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(shopId: string, tripId: string, snapshotId: string, epoch: number): string {
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign offline manifest epochs");
  const key = hkdfSync("sha256", authSecret, "", "diveday-offline-manifest-erasure-epoch-v1", 32);
  return createHmac("sha256", Buffer.from(key))
    .update(JSON.stringify([shopId, tripId, snapshotId, epoch]))
    .digest("base64url");
}

/** A server-authenticated epoch bound to one server-issued manifest snapshot. */
export function signOfflineErasureEpoch(input: {
  shopId: string;
  tripId: string;
  snapshotId: string;
  epoch: number;
}): string {
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 0) {
    throw new Error("Offline manifest erasure epoch must be a nonnegative safe integer");
  }
  const body = String(input.epoch);
  return `${body}.${signature(input.shopId, input.tripId, input.snapshotId, input.epoch)}`;
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
  if (parts.length !== 2) return null;
  const [body, supplied] = parts;
  if (!body || !/^\d{1,16}$/.test(body) || !supplied || !signatureShape.test(supplied)) return null;
  const epoch = Number(body);
  if (!Number.isSafeInteger(epoch) || epoch < 0 || String(epoch) !== body) return null;
  const expected = signature(input.shopId, input.tripId, input.snapshotId, epoch);
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
