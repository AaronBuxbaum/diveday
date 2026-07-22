import { getDb } from "@/db/client";
import { loadShopExport } from "@/db/export";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/authz";
import { exportFilename, zipExportBundle } from "@/lib/export";

/**
 * The full-shop export download. Authorization comes from the session, never
 * the URL: the bundle is always the signed-in staff member's own shop, and the
 * slug segment is only the address. Owner/manager only — the bundle carries
 * diver PII and medical evidence (see the export settings page).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user || !isStaff(session.user.roles)) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  if (!session.user.roles.includes("owner") && !session.user.roles.includes("manager")) {
    return Response.json({ error: "owner_or_manager_required" }, { status: 403 });
  }

  const data = await loadShopExport(await getDb(), session.user.shopId);
  if (!data) return Response.json({ error: "shop_not_found" }, { status: 404 });

  const zip = zipExportBundle(data);
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${exportFilename(data.shop.slug)}"`,
      // Always fresh: the export is the shop's live state, never a cache.
      "cache-control": "no-store",
    },
  });
}
