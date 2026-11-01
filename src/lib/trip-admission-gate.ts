import { authSecret } from "./auth-secret";
import { deriveLabelKey, signPayload, tagMatches } from "./signed-token";
import {
  decodeTripAdmissionRefusal,
  encodeTripAdmissionRefusal,
  type TripAdmissionRefusal,
} from "./trip-admission";

/**
 * A signed `?gate=` carries a specific `TripAdmissionRefusal` across a redirect.
 * The readable codes are not secret; the signature proves this deployment
 * emitted them and prevents anyone from inventing refusal copy for a staffer.
 *
 * HMAC-SHA256 uses an HKDF-derived `AUTH_SECRET` with a gate-specific purpose.
 * Scope is the route-owned trip id on trip/booking pages or person id on the
 * diver record; callers supply it from path params, never from the query.
 *
 * Invalid, absent, repeated, wrong-scope, or undecodable values return null.
 * Notice callers then use generic copy. This verifies a notice, not admission.
 */

/** Route-owned identity included in the signature to prevent cross-surface replay. */
export type TripAdmissionGateScope = { kind: "trip"; id: string } | { kind: "diver"; id: string };

/** Folded into the signed payload so a gate signature verifies as nothing else. */
const GATE_PURPOSE = "diveday-trip-admission-gate:v1";

/** Separates the readable codes from the signature. In no code, and unreserved in a URI. */
const SIGNATURE_SEPARATOR = ".";

function gateSecret(): string {
  // Production requires AUTH_SECRET; dev/e2e use auth-secret.ts's fixed fallback.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign trip-admission gates.");
  return deriveLabelKey(authSecret, "diveday-trip-admission-gate").toString("base64url");
}

function sign(scope: TripAdmissionGateScope, codes: string): string {
  const payload = `${GATE_PURPOSE}|${scope.kind}:${scope.id}|${codes}`;
  return signPayload(gateSecret(), payload);
}

/** The URL-safe `<codes>.<signature>` value to attach to `?gate=`. */
export function signTripAdmissionGate(
  refusal: TripAdmissionRefusal,
  scope: TripAdmissionGateScope,
): string {
  const codes = encodeTripAdmissionRefusal(refusal);
  return `${codes}${SIGNATURE_SEPARATOR}${sign(scope, codes)}`;
}

/** Return a decoded refusal only when this deployment signed it for this scope. */
export function verifyTripAdmissionGate(
  value: string | readonly string[] | undefined | null,
  scope: TripAdmissionGateScope,
): TripAdmissionRefusal | null {
  // Repeated query params arrive as arrays and are unverified.
  if (typeof value !== "string") return null;
  const separator = value.lastIndexOf(SIGNATURE_SEPARATOR);
  if (separator <= 0) return null;
  const codes = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!tagMatches(signature, sign(scope, codes))) return null;
  // A valid signature does not make malformed refusal codes valid.
  return decodeTripAdmissionRefusal(codes);
}
