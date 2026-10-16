import { strToU8, zipSync } from "fflate";
import { getDb } from "@/db/client";
import { canPersonExportShopData } from "@/db/export";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { monthKey, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { monthEndFiles } from "../month-end-files";

/**
 * **"Download month-end files"** (fifth loop, item 35): the month's report,
 * orders and crew sheet as one zip, the three downloads a bookkeeper asks for
 * at month end.
 *
 * Gated as the crew sheet is, the strictest of the three: diver names, crew
 * names and money leaving the tenant together is the full-shop export's class
 * of act, so the same owner/manager check (`canPersonExportShopData`), re-read
 * from the database so a demoted manager loses it at once, and the same
 * step-up challenge. **The shop comes from the session, never the URL.**
 * `?month=` is parsed, never trusted: anything but `YYYY-MM` is a 400.
 */
export async function GET(request: Request) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonExportShopData(db, session.user.shopId, session.user.personId))) {
    return new Response("Month-end files are limited to the shop's owner or manager.", {
      status: 403,
    });
  }
  const url = new URL(request.url);
  if (!(await hasRequiredStepUp(db, session, "export"))) {
    return Response.redirect(
      new URL(
        stepUpChallengeUrl(session.user.shopSlug, "export", `${url.pathname}${url.search}`),
        request.url,
      ),
      303,
    );
  }
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return new Response("Shop not found", { status: 404 });
  const month = parseMonthKey(url.searchParams.get("month"));
  if (!month) return new Response("Expected month=YYYY-MM", { status: 400 });

  const files = await monthEndFiles(
    db,
    shop,
    month,
    nowDate(),
    await requestLocale(shop.defaultLocale),
  );
  const zip = zipSync(Object.fromEntries(files.map((file) => [file.fileName, strToU8(file.csv)])));
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="diveday-month-end-${shop.slug}-${monthKey(month)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
