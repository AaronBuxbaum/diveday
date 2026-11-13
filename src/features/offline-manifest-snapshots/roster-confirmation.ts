import { authSecret } from "@/lib/auth-secret";
import { deriveLabelKey, signPayload, tagMatches } from "@/lib/signed-token";

const nonceShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Binding = {
  shopId: string;
  tripId: string;
  sessionId: string;
  nonce: string;
  renderId: string;
};

/** Binds a rendered roster's challenge to its server-side authenticated session. */
export function signRosterConfirmation(binding: Binding): string | null {
  if (
    !authSecret ||
    !binding.sessionId ||
    !nonceShape.test(binding.nonce) ||
    !nonceShape.test(binding.renderId)
  )
    return null;
  const key = deriveLabelKey(authSecret, "diveday-manifest-roster-confirmation-v1");
  return signPayload(
    key,
    JSON.stringify([
      binding.shopId,
      binding.tripId,
      binding.sessionId,
      binding.nonce,
      binding.renderId,
    ]),
  );
}

/** The supplied proof is never an authorization credential; the caller must check the live session. */
export function verifyRosterConfirmation(binding: Binding, proof: string): boolean {
  if (proof.length > 256) return false;
  return tagMatches(proof, () => signRosterConfirmation(binding) ?? "");
}
