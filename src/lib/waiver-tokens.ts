import { createHash, randomBytes } from "node:crypto";
import { type BookingLinkKeyring, deploymentKeyring } from "./booking-link-token";
import { signPayload } from "./signed-token";

/**
 * Minting and hashing a waiver link's bearer token — the only two things in the
 * waiver domain that need `node:crypto`, kept in their own module so that
 * import never reaches the browser.
 *
 * They used to live in `src/lib/waivers.ts` beside the pure rules, and that one
 * import cost the three most-visited public pages **440 KB of Node polyfills**.
 * The chain had no server boundary anywhere in it:
 *
 * ```
 * src/components/OfflineManifestView.tsx      "use client"
 *   -> src/i18n/readiness-labels.ts           REQUIRABLE_CERTIFICATION_LEVELS
 *     -> src/lib/readiness.ts                 waiverStanding
 *       -> src/lib/waivers.ts                 node:crypto
 *         -> next/dist/compiled/crypto-browserify
 * ```
 *
 * Turbopack resolves `node:crypto` in a client graph to `crypto-browserify`,
 * which drags in `stream-browserify`, `elliptic`, `bn.js`, `browserify-sign`,
 * `public-encrypt`, `pbkdf2` — and `vm-browserify`, whose
 * `Script.prototype.runInThisContext` is a literal `eval(this.code)`. That
 * chunk was a first-load chunk for `/offline-manifest`, `/s/[shopSlug]` and
 * `/s/[shopSlug]/trips/[id]`: the public schedule and the page a diver books
 * on.
 *
 * It was found by the Content-Security-Policy report-only pass (issue #718),
 * because it was the **only** violation the policy produced — every page load
 * tripped `'unsafe-eval'`, and this was why. Two entries reach the same tail
 * (`BookingSections.tsx` and `DiveDeclarationFields.tsx`, both through
 * `@/i18n/readiness-labels`), so moving the import rather than rerouting one
 * component is what actually closes it.
 *
 * **The chain above no longer exists, and the diagram is kept as history.** It
 * was cut a second time by issue #1354: `readiness-labels.ts` now takes
 * `REQUIRABLE_CERTIFICATION_LEVELS` from `./certification-levels.ts`, a leaf
 * that imports nothing, so its first line reads
 * `src/i18n/readiness-labels.ts -> src/lib/certification-levels.ts` and stops
 * there. What had grown back through it by then was not `node:crypto` but the
 * RSTC medical questionnaire's copy — 2,631 B gzip of it in the first load of
 * both public diver pages.
 *
 * That is the lesson worth keeping: **this edge has been cut twice.** Moving
 * the crypto out of the tail fixed the symptom the CSP pass could see and left
 * the edge itself standing, so the next thing to grow down it arrived
 * unannounced. `src/lib/certification-levels.test.ts` now fails if that leaf
 * grows an import, which is the narrow thing that actually holds.
 *
 * **Keep this module out of anything a client component can reach.** Nothing
 * but `src/db` should import it; the pure waiver rules stay in
 * `src/lib/waivers.ts` where the readiness chain can go on reading them.
 */

/** A fresh bearer token for one waiver link. The URL *is* the capability. */
export function createWaiverToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored, so a database read never yields a usable link. */
export function hashWaiverToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * **A waiver link is derived from its record** (#3903), as a booking link is
 * derived from its row (ADR 20261104-derived-booking-link-tokens): HMAC-SHA256
 * under the booking-link signing key over `"waiver-link\0" || version || "\0"
 * || record id`, 43 base64url characters, the same shape a random waiver token
 * has. The record still stores only `hashWaiverToken(token)` and every lookup
 * still matches that digest, so a database reader holds nothing replayable.
 *
 * Re-sending a live link (ADR 20260820-waiver-links-are-reused-not-reissued)
 * recomputes it under every key the deployment still holds
 * ({@link liveWaiverLinkToken}) and reuses the record only when one matches
 * its digest: a record whose digest was rotated (erasure, an identity
 * repoint), minted under a key no longer held, or minted at the counter or by
 * an import gets a fresh link instead. Throws when the deployment holds no
 * signing key, as issuing a booking link does.
 */
export function waiverLinkToken(
  recordId: string,
  keyring: BookingLinkKeyring = deploymentKeyring(),
): string {
  const version = keyring.signingVersion();
  const key = keyring.keyFor(version);
  if (!key) throw new Error(`No booking-link key for version ${version}`);
  return signPayload(key, `waiver-link\0${version}\0${recordId}`);
}

/** Booking-link key versions run 1 to 9 (`v2:`…`v9:`, with v1 the AUTH_SECRET-derived default). */
const KEY_VERSIONS = [9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

/**
 * The link a live record was handed out under, if this deployment can still
 * derive it: tried under every key the keyring holds, current and previous,
 * and matched against the stored digest (layer-2 dock review S3). Rotating
 * `BOOKING_LINK_SECRET` with the old one kept as `_PREVIOUS` therefore keeps
 * every live waiver link reusable, so a re-send the morning after a rotation
 * does not supersede the link a party already shared and lose its draft.
 */
export function liveWaiverLinkToken(
  recordId: string,
  tokenHash: string,
  keyring: BookingLinkKeyring = deploymentKeyring(),
): string | null {
  for (const version of KEY_VERSIONS) {
    const key = keyring.keyFor(version);
    if (!key) continue;
    const token = signPayload(key, `waiver-link\0${version}\0${recordId}`);
    if (hashWaiverToken(token) === tokenHash) return token;
  }
  return null;
}
