import { authSecret } from "./auth-secret";
import { nowMs } from "./clock";
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
 * The signature covers, beside the codes, everything the refusal was about:
 * the route-owned trip id on trip/booking pages or person id on the diver
 * record, the notice it rides with, the booking it describes (when it
 * describes one), and the instant it was minted. Callers supply all of it from
 * path params and the notice they are rendering, never from the query's gate,
 * so a genuine gate cannot be pasted beside another notice or onto another
 * seat, and does not outlive {@link GATE_LIFETIME_MS} (issue #3777).
 *
 * Invalid, absent, repeated, wrong-binding, expired, or undecodable values
 * return null. Notice callers then use generic copy. This verifies a notice,
 * not admission.
 */

/** Route-owned identity included in the signature to prevent cross-surface replay. */
export type TripAdmissionGateScope = { kind: "trip"; id: string } | { kind: "diver"; id: string };

/**
 * What a gate is about: its route, the notice it rides with, and the booking
 * it describes (`null` for a refusal raised before any seat existed).
 */
export type TripAdmissionGateBinding = {
  scope: TripAdmissionGateScope;
  notice: string;
  bookingId: string | null;
};

/** The binding of a gate on a trip page: the departure, the notice and the seat it names, if any. */
export function tripGateBinding(
  tripId: string,
  notice: string,
  bookingId: string | null = null,
): TripAdmissionGateBinding {
  return { scope: { kind: "trip", id: tripId }, notice, bookingId: bookingId ?? null };
}

/** A refusal is a fact about now; after a day the banner falls back to its generic sentence. */
export const GATE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** A gate minted this far ahead of our clock is not ours. */
const GATE_FUTURE_SKEW_MS = 60 * 1000;

/**
 * Folded into the signed payload so a gate signature verifies as nothing else.
 * v2: the codes are ladder blockers. v3: the notice, the seat and the issue
 * time are signed too; an older link shows the generic notice rather than
 * decoding.
 */
const GATE_PURPOSE = "diveday-trip-admission-gate:v3";

/** Separates the readable codes, the issue time and the signature. In no code, and unreserved in a URI. */
const SEPARATOR = ".";

function gateSecret(): string {
  // Production requires AUTH_SECRET; dev/e2e use auth-secret.ts's fixed fallback.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign trip-admission gates.");
  return deriveLabelKey(authSecret, "diveday-trip-admission-gate").toString("base64url");
}

function sign(binding: TripAdmissionGateBinding, issuedAt: string, codes: string): string {
  const { scope, notice, bookingId } = binding;
  const payload = [
    GATE_PURPOSE,
    `${scope.kind}:${scope.id}`,
    notice,
    bookingId ?? "",
    issuedAt,
    codes,
  ].join("|");
  return signPayload(gateSecret(), payload);
}

/** The URL-safe `<codes>.<issued>.<signature>` value to attach to `?gate=`. */
export function signTripAdmissionGate(
  refusal: TripAdmissionRefusal,
  binding: TripAdmissionGateBinding,
  now: number = nowMs(),
): string {
  const codes = encodeTripAdmissionRefusal(refusal);
  const issuedAt = Math.floor(now / 1000).toString(36);
  return [codes, issuedAt, sign(binding, issuedAt, codes)].join(SEPARATOR);
}

/**
 * Return a decoded refusal only when this deployment signed it for this
 * route, notice and seat, and recently enough.
 */
export function verifyTripAdmissionGate(
  value: string | readonly string[] | undefined | null,
  binding: TripAdmissionGateBinding,
  now: number = nowMs(),
): TripAdmissionRefusal | null {
  // Repeated query params arrive as arrays and are unverified.
  if (typeof value !== "string") return null;
  const signatureAt = value.lastIndexOf(SEPARATOR);
  if (signatureAt <= 0) return null;
  const issuedAtAt = value.lastIndexOf(SEPARATOR, signatureAt - 1);
  if (issuedAtAt < 0) return null;
  const codes = value.slice(0, issuedAtAt);
  const issuedAt = value.slice(issuedAtAt + 1, signatureAt);
  const signature = value.slice(signatureAt + 1);
  if (!/^[0-9a-z]{1,10}$/.test(issuedAt)) return null;
  if (!tagMatches(signature, () => sign(binding, issuedAt, codes))) return null;
  const issuedMs = Number.parseInt(issuedAt, 36) * 1000;
  if (now - issuedMs > GATE_LIFETIME_MS || issuedMs - now > GATE_FUTURE_SKEW_MS) return null;
  // A valid signature does not make malformed refusal codes valid.
  return decodeTripAdmissionRefusal(codes);
}
