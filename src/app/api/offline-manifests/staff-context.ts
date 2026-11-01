import { loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";

/** These identity and roster responses are private to the signed-in staffer. */
export const OFFLINE_MANIFEST_NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Applies the shared staff gate before either offline-manifest endpoint reads
 * endpoint-specific data. Shop scope always comes from the authenticated
 * session, and live roles are checked after resolving that shop so a missing
 * shop remains a 404.
 */
export async function authorizeOfflineManifestStaff() {
  const session = await auth();
  // Avoid a database connection when the session never claimed staff access.
  if (!session?.user || !isStaff(session.user.roles)) {
    return {
      response: Response.json(
        { error: "authentication_required" },
        { status: 401, headers: OFFLINE_MANIFEST_NO_STORE },
      ),
    };
  }

  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) {
    return {
      response: Response.json(
        { error: "not_found" },
        { status: 404, headers: OFFLINE_MANIFEST_NO_STORE },
      ),
    };
  }

  const roles = await loadActiveStaffRoles(db, shop.id, session.user.personId);
  if (!roles || !isStaff(roles)) {
    return {
      response: Response.json(
        { error: "authentication_required" },
        { status: 401, headers: OFFLINE_MANIFEST_NO_STORE },
      ),
    };
  }

  return { db, shop, user: session.user };
}
