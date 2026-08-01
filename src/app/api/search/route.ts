import { getDb } from "@/db/client";
import { searchShop } from "@/db/search";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";

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
 * directory's other staff-gated GETs.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const results = shop
    ? await searchShop(
        db,
        session.user.shopId,
        query,
        shop.timezone,
        await requestLocale(shop.defaultLocale),
      )
    : { divers: [], trips: [], diveSites: [], courses: [], orders: [] };

  return Response.json(results, { headers: { "Cache-Control": "private, no-store" } });
}
