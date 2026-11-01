import type { OfflineManifestIdentityResponse } from "@/lib/offline-manifests";
import {
  authorizeOfflineManifestStaff,
  OFFLINE_MANIFEST_NO_STORE,
} from "@/app/api/offline-manifests/staff-context";

/**
 * Never cached, and the reason is the whole point of this route.
 *
 * The one caller is the offline shell, which runs on a shared boat tablet. It
 * uses this answer to decide which of the device's saved rosters belong to
 * somebody else and must be deleted (`purgeOfflineManifestsExceptShop`). A
 * response cached across two staff sign-ins on that tablet inverts that
 * decision exactly: the second shop's browser would be told it is the first
 * shop, so the purge would delete the *current* captain's manifests — the ones
 * they are standing on the dock reading — and preserve the previous shop's
 * roster, which is the cross-tenant residency this check exists to end. Both
 * failure directions land at once, and neither is visible from the boat.
 *
 * `private` as well as `no-store` because the answer is per-session: even a
 * well-behaved shared proxy must never hold it for a second caller.
 */
/**
 * "Which shop is this browser signed in as?" — one string, and nothing else.
 *
 * The offline shell used to learn this by calling
 * `GET /api/offline-manifests/upcoming`, which answers a one-word question with
 * the shop's entire 48-hour board: every diver's name, emergency contact, and
 * readiness blocker (review 20260802, action item 12). This route is the honest
 * shape for that question. It is deliberately a separate path rather than an
 * `?identityOnly=1` flag on the roster route, because the two are different
 * questions with different consequences: a dropped or mistyped query parameter
 * degrades to the *roster* — silently, with a 200 — whereas a path cannot fail
 * open that way, and a request logged against this path is legible as
 * identity-only in an access log without anyone having to read its query
 * string. It is also far cheaper: one primary-key row read, no trip window, no
 * per-trip manifest assembly, no locale negotiation — which matters because the
 * shell blocks its purge on this request over a marina connection.
 *
 * It shares the roster route's staff gate and session-derived shop scope.
 *
 * The slug is read from the database rather than taken from
 * `session.user.shopSlug`, which is carried on the session token and can be
 * stale. It must agree with the slug baked into the snapshots on the device,
 * and those come from this same row (`serializeManifests`) — if the two ever
 * disagreed, the purge would read the device's own records as a foreign shop's
 * and delete them.
 */
export async function GET() {
  const access = await authorizeOfflineManifestStaff();
  if ("response" in access) return access.response;

  // Only the slug is serialized. The row carries the whole shop record and the
  // purge needs one field of it, so everything else stops here rather than
  // riding along — including counts, which would leak how big the board is.
  // The annotation is the guard: widening this body is a type change the one
  // reader has to agree to, not something that happens by spreading a row.
  const body: OfflineManifestIdentityResponse = { shop: { slug: access.shop.slug } };
  return Response.json(body, { headers: OFFLINE_MANIFEST_NO_STORE });
}
