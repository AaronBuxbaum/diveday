import { createHash } from "node:crypto";
import { authSecret } from "@/lib/auth-secret";
import { OFFLINE_MANIFEST_MAX_RETENTION_MS } from "@/lib/offline-manifests";
import { deriveLabelKey, signPayload, tagMatches } from "@/lib/signed-token";

// WIP: this proof authenticates bytes and scope, not current authorization.
// Its future route must independently recheck the live staff session, shop,
// trip, erasure epoch and expiry. Never sign a client-supplied projection.
type Binding = {
  shopId: string;
  tripId: string;
  checkpoint: string;
  sessionHandle: string;
  nonce: string;
  erasureEpoch: number;
  digest: string;
  issuedAt: number;
  expiresAt: number;
};

const tagShape = /^[A-Za-z0-9_-]{43}$/;
const nonceShape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Digest the exact serialized bytes sent to the client, not a second read. */
export function hashManifestProjection(serialized: string): string {
  return createHash("sha256").update(serialized, "utf8").digest("base64url");
}

export function signLiveManifestProjection(binding: Binding): string | null {
  if (
    !authSecret ||
    !binding ||
    typeof binding.shopId !== "string" ||
    !binding.shopId ||
    binding.shopId.length > 128 ||
    typeof binding.tripId !== "string" ||
    !binding.tripId ||
    binding.tripId.length > 128 ||
    typeof binding.checkpoint !== "string" ||
    !binding.checkpoint ||
    binding.checkpoint.length > 128 ||
    typeof binding.sessionHandle !== "string" ||
    !tagShape.test(binding.sessionHandle) ||
    typeof binding.nonce !== "string" ||
    !nonceShape.test(binding.nonce) ||
    typeof binding.digest !== "string" ||
    !tagShape.test(binding.digest) ||
    !Number.isSafeInteger(binding.erasureEpoch) ||
    binding.erasureEpoch < 0 ||
    !Number.isSafeInteger(binding.issuedAt) ||
    !Number.isSafeInteger(binding.expiresAt) ||
    binding.expiresAt <= binding.issuedAt ||
    binding.expiresAt - binding.issuedAt > OFFLINE_MANIFEST_MAX_RETENTION_MS
  )
    return null;
  const key = deriveLabelKey(authSecret, "diveday-live-manifest-projection-v1");
  return signPayload(
    key,
    JSON.stringify([
      binding.shopId,
      binding.tripId,
      binding.checkpoint,
      binding.sessionHandle,
      binding.nonce,
      binding.erasureEpoch,
      binding.digest,
      binding.issuedAt,
      binding.expiresAt,
    ]),
  );
}

export function verifyLiveManifestProjection(
  binding: Binding,
  proof: unknown,
  now: number,
): boolean {
  if (
    !binding ||
    typeof proof !== "string" ||
    proof.length !== 43 ||
    !Number.isSafeInteger(now) ||
    now < binding.issuedAt ||
    now >= binding.expiresAt
  )
    return false;
  return tagMatches(proof, () => signLiveManifestProjection(binding) ?? "");
}
