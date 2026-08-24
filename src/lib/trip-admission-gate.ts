import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-secret";
import {
  decodeTripAdmissionRefusal,
  encodeTripAdmissionRefusal,
  type TripAdmissionRefusal,
} from "./trip-admission";

/**
 * **The `?gate=` param, signed.**
 *
 * `src/lib/trip-admission.ts` flattens a `TripAdmissionRefusal` into one
 * query-param value so a staff seating's refusal survives the server action's
 * redirect. The codec is sound — it rejects unknown codes rather than
 * half-decoding them — but a codec proves only that a value is *well-formed*,
 * never that the refusal it describes ever happened. Without a signature,
 * anyone who gets a staffer to open a link renders a fabricated, specific
 * refusal:
 *
 * ```
 * /shop/<slug>/trips/<id>/guests?notice=diver-trip-prerequisite&gate=~~deep~0
 * ```
 *
 * — "…their Deep card isn't on file", which is exactly the sentence that points
 * a staffer at the certifications form, where a hand-entered card lands
 * `pending` and clears `decideTripAdmission` on the next attempt (H-24). The
 * tamper never bypasses a gate itself; it manufactures the prompt that gets a
 * staffer to bypass one. So the value is signed (security review finding).
 *
 * ## What is signed, and what it is bound to
 *
 * HMAC-SHA256 over `purpose | scope | codes`, keyed on a secret derived from
 * `AUTH_SECRET` by HKDF with its own info string — the same purpose-separation
 * `src/lib/recap-links.ts` uses, so a gate signature and a recap token are
 * never interchangeable and neither is the session-JWT key.
 *
 * **The scope is what stops a replay.** A signature that covered only the four
 * codes would be a bearer sentence: a staffer's own genuine refusal URL for one
 * departure, pasted at another, would still verify and still say "this charter
 * requires a Deep card" about a boat that requires nothing. So the payload
 * carries the id of the *route segment the landing page owns*, and the reader
 * re-supplies it from its own `params` rather than from the query:
 *
 * - the trip surfaces (`/trips/[id]`, `/trips/[id]/guests`,
 *   `/bookings/new/[tripId]`) bind to the **trip id**;
 * - the diver record (`/divers/[personId]`), which has no departure in its URL
 *   at all, binds to the **person id**.
 *
 * Binding to a value the query supplies would be worthless — an attacker who
 * held a signature would simply supply the matching id with it. A path segment
 * the route resolved is the only value the reader can trust.
 *
 * ## What a failed verification does
 *
 * Returns null, and every caller falls back to the notice's own **generic**
 * sentence — never a blank banner, and never the specific one. A refusal a
 * staffer cannot read is a worse outcome than a vague one; a specific refusal
 * nobody can vouch for is worse than both.
 *
 * The codes stay legible in the URL (the signature is appended after a `.`)
 * rather than being wrapped in an opaque blob. Nothing in them is secret from
 * the staffer reading the page, and a debuggable param is worth more than the
 * obfuscation would buy.
 */

/**
 * The identity the signature is bound to: whichever id the landing route holds
 * as a path segment. Two kinds rather than one because the three reading
 * surfaces genuinely differ — see the module docstring.
 */
export type TripAdmissionGateScope = { kind: "trip"; id: string } | { kind: "diver"; id: string };

/** Folded into the signed payload so a gate signature verifies as nothing else. */
const GATE_PURPOSE = "diveday-trip-admission-gate:v1";

/** Separates the readable codes from the signature. In no code, and unreserved in a URI. */
const SIGNATURE_SEPARATOR = ".";

function gateSecret(): string {
  // In production Auth.js refuses to boot without AUTH_SECRET; this is only
  // ever null in dev/e2e, where auth-secret.ts supplies a fixed fallback. Fail
  // loud rather than sign with an empty key.
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign trip-admission gates.");
  const derived = hkdfSync("sha256", authSecret, "", "diveday-trip-admission-gate", 32);
  return Buffer.from(derived).toString("base64url");
}

function sign(scope: TripAdmissionGateScope, codes: string): string {
  const payload = `${GATE_PURPOSE}|${scope.kind}:${scope.id}|${codes}`;
  return createHmac("sha256", gateSecret()).update(payload).digest("base64url");
}

/**
 * The value to hang off `?gate=` — `<codes>.<signature>`, URL-safe as written
 * (the codes use `~`/`-`, the signature base64url, both unreserved).
 */
export function signTripAdmissionGate(
  refusal: TripAdmissionRefusal,
  scope: TripAdmissionGateScope,
): string {
  const codes = encodeTripAdmissionRefusal(refusal);
  return `${codes}${SIGNATURE_SEPARATOR}${sign(scope, codes)}`;
}

/**
 * The refusal a `?gate=` describes, **iff** this deployment signed it for this
 * exact scope. Null for anything else — absent, repeated (`string[]`),
 * unsigned, signed for another departure, or well-signed over codes the codec
 * refuses.
 */
export function verifyTripAdmissionGate(
  value: string | readonly string[] | undefined | null,
  scope: TripAdmissionGateScope,
): TripAdmissionRefusal | null {
  // An array is what `?gate=a&gate=b` delivers, and it is truthy — the shape
  // that used to reach `.split()` and 500 the page.
  if (typeof value !== "string") return null;
  const separator = value.lastIndexOf(SIGNATURE_SEPARATOR);
  if (separator <= 0) return null;
  const codes = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sign(scope, codes);
  // Length-guard before timingSafeEqual, which throws on unequal buffers.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  // Signed by us, for this page — but still only as trustworthy as the codec
  // says. A signature over a malformed body is not a licence to half-decode it.
  return decodeTripAdmissionRefusal(codes);
}
