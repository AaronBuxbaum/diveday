import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { getTripManifests } from "@/db/manifests";
import { getShopById } from "@/db/shops";
import { listTripIdsInOfflineManifestWindow } from "@/db/trips";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import type {
  OfflineManifestPayload,
  OfflineManifestUpcomingResponse,
} from "@/lib/offline-manifests";
import { serializeManifests } from "@/lib/offline-manifests";

// See ADR 20260726-shopwide-offline-manifest-priming: 48 hours covers "today
// and tomorrow" in any shop timezone without depending on a staffer having
// opened that specific trip's live manifest first, while staying well short
// of caching a shop's entire future board on every device that visits it.
const AUTO_SAVE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * This body is a shop's whole 48-hour board — diver names, emergency contacts,
 * readiness blockers — and it must never sit in any cache but the encrypted
 * IndexedDB store it is fetched to fill. `private` keeps it out of a shared
 * proxy; `no-store` keeps it out of the browser's own disk cache and out of a
 * back/forward replay on the shared boat tablet this whole feature runs on
 * (review 20260802, action item 12).
 */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Every scheduled trip in the rolling window — including one already
 * underway, not only ones yet to depart, so a trip mid-charter still gets
 * its after-dive-checkpoint copy auto-saved — serialized the same way a
 * single trip's live manifest page is, so the client can feed each one
 * straight into the existing saveOfflineManifest path unchanged.
 * Staff-session-gated and scoped to the caller's own shop, the same way the
 * per-trip manifest page and its SSE stream are — and gated on the caller's
 * *live* roles, byte-identically to `/api/offline-manifests/identity`. This is
 * the body that made that matter: a staffer removed from the shop kept pulling
 * the whole board from any device for as long as their token lasted.
 *
 * Only for callers that genuinely want the roster: the shop layout's
 * `OfflineManifestAutoSave` and the service worker's `refreshSavedManifests`.
 * A caller that only needs to know *which shop this browser is signed in as*
 * asks `GET /api/offline-manifests/identity` instead, which answers with one
 * string and none of this.
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
  // primary-key row read apart, and everything expensive — the trip window, the
  // per-trip manifest assembly, the locale negotiation — is still below this.
  const roles = await loadActiveStaffRoles(db, shop.id, session.user.personId);
  if (!roles || !isStaff(roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
  }

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const now = nowDate();
  const windowEnd = new Date(now.getTime() + AUTO_SAVE_WINDOW_MS);
  const tripIds = await listTripIdsInOfflineManifestWindow(db, shop.id, now, windowEnd);

  const shopIdentity = {
    slug: shop.slug,
    name: shop.name,
    timezone: shop.timezone,
    // Primed with the board, because the whole point is that it is already on
    // the device when the signal goes (issue #688).
    emergencyReference: shop.emergencyReference,
  };
  const payloads = await Promise.all(
    tripIds.map(async (tripId): Promise<OfflineManifestPayload | null> => {
      const manifests = await getTripManifests(db, shop.id, tripId);
      if (!manifests) return null;
      return serializeManifests(manifests, shopIdentity, (blocker) =>
        readinessBlockerText(t, blocker),
      );
    }),
  );

  const body: OfflineManifestUpcomingResponse = {
    // Always returned, even with zero trips in the window: a caller that is
    // already paying for the roster gets the server-verified "who am I signed
    // in as" signal in the same response rather than a second request, and uses
    // it to purge any other shop's leftover device records — see ADR
    // 20260726-shopwide-offline-manifest-priming's cross-tenant-device
    // addendum. A payload can never carry a shop.slug the caller doesn't own
    // (serializeManifests only ever receives this same session-derived shop).
    // A caller that wants *only* this asks `/api/offline-manifests/identity`,
    // which is the same string without the board attached.
    shop: shopIdentity,
    payloads: payloads.filter((payload): payload is OfflineManifestPayload => payload !== null),
  };
  return Response.json(body, { headers: NO_STORE });
}
