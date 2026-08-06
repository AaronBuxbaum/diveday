import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { searchShop } from "@/db/search";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * The command palette's only data source. A GET so the browser can fire one
 * per keystroke without queuing behind Server Actions' per-client POST
 * serialization (or behind an in-flight mutation action) — see ADR-free audit
 * task "Move command-palette search off Server Actions onto a GET route".
 *
 * Auth and shop scope are re-derived from the session on every call, exactly
 * as `searchShopAction` (src/app/actions/search.ts, now removed) did: same
 * `auth()` + `isStaff()` staff gate other JSON API routes in this directory
 * use (src/app/api/offline-manifests/upcoming, .../manifest-events), same
 * `getShopById(session.user.shopId)` shop lookup, same `searchShop` call —
 * so the query can never reach beyond the signed-in staffer's own shop.
 * `requireStaffSession()` itself isn't used here because it calls
 * `redirect()`, which is meant for page navigation, not a `fetch()`-based
 * JSON endpoint; returning a 401 is the established pattern for this
 * directory's other staff-gated GETs. "Same gate" now means the *live* one:
 * `auth()` as a pre-filter, then the caller's current `person_roles`.
 */
export async function GET(request: Request) {
  const session = await auth();
  // A pre-filter, not the gate. Deliberately ahead of any database work so a
  // caller with no session — or a token that never claimed a staff role — is
  // refused without costing a connection (there is a test asserting `getDb` is
  // never reached on this path). The roles it reads are whatever the JWT was
  // stamped with at sign-in, which is exactly why it cannot be the last word.
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // The tenant could not be established. This route has always answered that
  // with an empty result set rather than a status — the palette renders "no
  // results" instead of an error — and the branch is kept, and kept *ahead* of
  // the live-roles check, for the same sequencing reason the sibling
  // offline-manifest routes keep their 404 there: `loadActiveStaffRoles` is
  // shop-scoped, so a session pointing at a shop row that no longer exists finds
  // no person and would turn this into a 401. "The tenant cannot be established"
  // is a different fact from "you are no longer their staff", and this constant
  // discloses nothing either way.
  if (!shop) {
    return Response.json(
      { divers: [], trips: [], diveSites: [], courses: [], orders: [] },
      { headers: NO_STORE },
    );
  }

  // The gate that decides: live roles, re-read on every keystroke's request. No
  // `maxAge` is set on the session (src/lib/auth.config.ts), so NextAuth's
  // 30-day default applies — a staffer removed from this shop this morning still
  // carries `captain` in their token for a month, and `/api/**` is outside the
  // edge gate (src/proxy.ts), so this handler is the only wall.
  // `loadActiveStaffRoles` exists for that window (ADR 20260724-role-
  // authorization): it is null for a deleted person, a disabled account, or
  // someone who was never this shop's, and the roles it does return are the
  // `person_roles` of right now. What it is holding shut is every diver, trip,
  // dive site, course and order name in the shop, reachable one substring at a
  // time — `searchShop` below is still under it.
  const roles = await loadActiveStaffRoles(db, shop.id, session.user.personId);
  if (!roles || !isStaff(roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE });
  }

  const results = await searchShop(
    db,
    session.user.shopId,
    query,
    shop.timezone,
    await requestLocale(shop.defaultLocale),
  );

  return Response.json(results, { headers: NO_STORE });
}
