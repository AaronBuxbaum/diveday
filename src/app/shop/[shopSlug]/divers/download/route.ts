import { getDb } from "@/db/client";
import { isDiverFilter, isDiverSort, listDiversForExport } from "@/db/divers";
import { canPersonExportShopData } from "@/db/export";
import { getShopById } from "@/db/shops";
import { nowDate } from "@/lib/clock";
import { exportDateStamp } from "@/lib/export";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { diversListCsv } from "./divers-list-csv";

/**
 * **"Download this list (CSV)"** on Divers (fourth UX review, item 27): the
 * roster under the view, search and order on screen, as a call list.
 *
 * Security-sensitive: diver names and contact details leaving the tenant. The
 * gate is the full-shop export's (`canPersonExportShopData`, owner or
 * manager, re-read from the database so a demoted manager loses it at once)
 * and its step-up challenge. The shop is the session's, never the slug; a slug
 * naming another shop is a 404. The Removed view is a restore door, not a call
 * list, and is refused like a hand-typed filter on the page would be for a
 * reader who may not restore.
 */
export async function GET(request: Request, { params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop || shop.slug !== shopSlug) return new Response("Not found", { status: 404 });
  if (!(await canPersonExportShopData(db, shop.id, session.user.personId))) {
    return new Response("Diver lists are limited to the shop's owner or manager.", {
      status: 403,
    });
  }
  const url = new URL(request.url);
  if (!(await hasRequiredStepUp(db, session, "export"))) {
    return Response.redirect(
      new URL(stepUpChallengeUrl(shop.slug, "export", `${url.pathname}${url.search}`), request.url),
      303,
    );
  }

  const search = url.searchParams;
  const requested = search.get("filter") ?? undefined;
  const filter = isDiverFilter(requested) && requested !== "removed" ? requested : "all";
  const sortParam = search.get("sort") ?? undefined;
  const now = nowDate();
  const result = await listDiversForExport(db, shop.id, {
    query: search.get("q") ?? "",
    filter,
    sort: isDiverSort(sortParam) ? sortParam : "name",
    timeZone: shop.timezone,
    now,
  });
  if (result.exceededLimit) {
    const rosterUrl = new URL(shopPath(shop.slug, "divers"), request.url);
    const query = search.get("q");
    if (query) rosterUrl.searchParams.set("q", query);
    if (filter !== "all") rosterUrl.searchParams.set("filter", filter);
    if (isDiverSort(sortParam) && sortParam !== "name") {
      rosterUrl.searchParams.set("sort", sortParam);
    }
    rosterUrl.searchParams.set("notice", "download-too-large");
    return new Response(null, {
      status: 303,
      headers: { Location: rosterUrl.toString(), "Cache-Control": "no-store" },
    });
  }
  const fileName = `diveday-divers-${shop.slug}-${exportDateStamp(now, shop.timezone)}.csv`;
  return new Response(diversListCsv(result.rows, shop.timezone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
