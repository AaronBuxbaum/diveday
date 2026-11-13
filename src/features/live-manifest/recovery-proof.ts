import { authSecret } from "@/lib/auth-secret";
import { MINUTE_MS } from "@/lib/clock";
import { deriveLabelKey, signPayload, tagMatches } from "@/lib/signed-token";

// WIP: a proof binds one recovery attempt but does not authorize a session.
// A future route must derive the handle from the current live staff session
// and recheck the authoritative shop erasure epoch before signing/verifying.
type Binding = {
  shopId: string;
  sessionHandle: string;
  tombstone: string;
  nonce: string;
  erasureEpoch: number;
  issuedAt: number;
  expiresAt: number;
};

const tagShape = /^[A-Za-z0-9_-]{43}$/;
const nonceShape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function signLiveManifestRecovery(binding: Binding): string | null {
  if (
    !authSecret ||
    !binding ||
    typeof binding.shopId !== "string" ||
    !binding.shopId ||
    binding.shopId.length > 128 ||
    typeof binding.sessionHandle !== "string" ||
    !tagShape.test(binding.sessionHandle) ||
    typeof binding.tombstone !== "string" ||
    !nonceShape.test(binding.tombstone) ||
    typeof binding.nonce !== "string" ||
    !nonceShape.test(binding.nonce) ||
    !Number.isSafeInteger(binding.erasureEpoch) ||
    binding.erasureEpoch < 0 ||
    !Number.isSafeInteger(binding.issuedAt) ||
    !Number.isSafeInteger(binding.expiresAt) ||
    binding.expiresAt <= binding.issuedAt ||
    binding.expiresAt - binding.issuedAt > 5 * MINUTE_MS
  )
    return null;
  const key = deriveLabelKey(authSecret, "diveday-live-manifest-recovery-v1");
  return signPayload(
    key,
    JSON.stringify([
      binding.shopId,
      binding.sessionHandle,
      binding.tombstone,
      binding.nonce,
      binding.erasureEpoch,
      binding.issuedAt,
      binding.expiresAt,
    ]),
  );
}

export function verifyLiveManifestRecovery(binding: Binding, proof: unknown, now: number): boolean {
  if (
    !binding ||
    typeof proof !== "string" ||
    proof.length !== 43 ||
    !Number.isSafeInteger(now) ||
    now < binding.issuedAt ||
    now >= binding.expiresAt
  )
    return false;
  return tagMatches(proof, () => signLiveManifestRecovery(binding) ?? "");
}
