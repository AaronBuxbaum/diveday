import { getDb } from "@/db/client";
import { canPersonExportShopData, loadShopExportBundleInput } from "@/db/export";
import { nowDate } from "@/lib/clock";
import { buildExportBundle, exportFileName, zipExportBundle } from "@/lib/export";
import { requireStaffSession } from "@/lib/session";

/**
 * Returns the full-shop export ZIP (ADR 20260722-full-shop-export). The shop
 * comes from the session, never the URL — and because the bundle carries the
 * whole roster's contact details and signed medical evidence, it is gated to
 * owner/manager, re-checked against the database rather than the session's
 * JWT so a demoted or disabled manager loses access immediately.
 */
export async function GET() {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonExportShopData(db, session.user.shopId, session.user.personId))) {
    return new Response("The data export is limited to the shop's owner or manager.", {
      status: 403,
    });
  }
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
