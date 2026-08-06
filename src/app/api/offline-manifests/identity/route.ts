import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import type { OfflineManifestIdentityResponse } from "@/lib/offline-manifests";

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
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

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
 * Same staff gate and same session-derived shop scope as the roster route: the
 * answer is derived from `session.user.shopId`, never from anything the caller
 * sends, so there is no parameter to point at another tenant. "Same gate" is
 * meant literally — the two handlers' gates are byte-identical on purpose, and
 * the disclosure here being smaller is not a reason to let them drift. A reader
 * comparing them must not have to work out which of two near-identical checks
 * is the strict one.
 *
 * The slug is read from the database rather than taken from
 * `session.user.shopSlug`, which is carried on the session token and can be
 * stale. It must agree with the slug baked into the snapshots on the device,
 * and those come from this same row (`serializeManifests`) — if the two ever
 * disagreed, the purge would read the device's own records as a foreign shop's
 * and delete them.
 */
export async function GET() {
  const session = await auth();
  // A pre-filter, not the gate. Deliberately ahead of any database work so a
  // caller with no session — or a token that never claimed a staff role — is
  // refused without costing a connection (there is a test asserting `getDb` is
  // never reached on this path). The roles it reads are whatever the JWT was
  // stamped with at sign-in, which is exactly why it cannot be the last word.
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
  }
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  // The gate that decides: live roles, re-read on every request. No `maxAge` is
  // set on the session (src/lib/auth.config.ts), so NextAuth's 30-day default
  // applies — a staffer removed from this shop this morning still carries
  // `captain` in their token for a month, and `/api/**` is outside the edge gate
  // (src/proxy.ts), so this handler is the only wall. `loadActiveStaffRoles`
  // exists for that window (ADR 20260724-role-authorization): it is null for a
  // deleted person, a disabled account, or someone who was never this shop's,
  // and the roles it does return are the `person_roles` of right now.
  //
  // After the shop lookup rather than before, and the order is load-bearing:
  // `loadActiveStaffRoles` is shop-scoped, so a session pointing at a shop row
  // that no longer exists finds no person and would answer 401 where the shell
  // is owed a 404 — "the tenant cannot be established" is a different fact from
  // "you are no longer their staff", and only one of them is about the caller.
  // Nothing has been said to the caller yet either way; the two refusals are one
  // primary-key row read apart.
  const roles = await loadActiveStaffRoles(db, shop.id, session.user.personId);
  if (!roles || !isStaff(roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
  }

  // Only the slug is serialized. The row carries the whole shop record and the
  // purge needs one field of it, so everything else stops here rather than
  // riding along — including counts, which would leak how big the board is.
  // The annotation is the guard: widening this body is a type change the one
  // reader has to agree to, not something that happens by spreading a row.
  const body: OfflineManifestIdentityResponse = { shop: { slug: shop.slug } };
  return Response.json(body, { headers: NO_STORE });
}
