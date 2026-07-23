import { getDb } from "@/db/client";
import { loadShopExportBundleInput } from "@/db/export";
import { canExportShopData } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { buildExportBundle, exportFileName, zipExportBundle } from "@/lib/export";
import { requireStaffSession } from "@/lib/session";

/**
 * Returns the full-shop export ZIP (ADR 20260722-full-shop-export). The shop
 * comes from the session, never the URL — and because the bundle carries the
 * whole roster's contact details and signed medical evidence, it is gated to
 * owner/manager, not just staff.
 */
export async function GET() {
  const session = await requireStaffSession();
  if (!canExportShopData(session.user.roles)) {
    return new Response("The data export is limited to the shop's owner or manager.", {
      status: 403,
    });
  }
  const db = await getDb();
  const input = await loadShopExportBundleInput(db, session.user.shopId);
  if (!input) return new Response("Shop not found", { status: 404 });

  const now = nowDate();
  const zip = zipExportBundle(buildExportBundle(input, now));
  const fileName = exportFileName(input.shopSlug, now, input.timezone);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
