import { getDb } from "@/db/client";
import { crewSheetForMonth } from "@/db/crew-sheet";
import { canPersonExportShopData } from "@/db/export";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { type MonthRef, monthKey, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { assembleCrewSheet, buildCrewSheetCsv, crewSheetFileName } from "@/lib/crew-sheet";
import { cachedListFormat } from "@/lib/intl-cache";
import { toShopCurrency } from "@/lib/money";
import { hasRequiredStepUp, stepUpChallengeUrl } from "@/lib/security-step-up";
import { requireStaffSession } from "@/lib/session";
import { utcToWallTime } from "@/lib/zoned";

/**
 * **The crew sheet for one month, as a CSV** (N-43).
 *
 * Per crew member: the departures they worked, the jobs they did, the hours
 * those departures ran, and their share of the month's tips. **Not payroll** —
 * no rate, no total owed, no period — and nothing on this route or the section
 * that links it says otherwise.
 *
 * Gated exactly like the full-shop export beside it: crew names and money
 * leaving the tenant is the same class of act as the bundle, so it takes the
 * same owner/manager check, re-read from the database rather than the
 * session's JWT so a demoted manager loses it immediately, and the same
 * step-up challenge. **The shop comes from the session, never the URL** — a
 * capability URL is never protected by the page that links it.
 *
 * `?month=` is the one input, and it is parsed rather than trusted:
 * `parseMonthKey` returns null for anything that is not `YYYY-MM`, and this
 * answers 400 instead of quietly serving some other month.
 */
export async function GET(request: Request) {
  const session = await requireStaffSession();
  const db = await getDb();
  if (!(await canPersonExportShopData(db, session.user.shopId, session.user.personId))) {
    return new Response("The crew sheet is limited to the shop's owner or manager.", {
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

  const requested = url.searchParams.get("month");
  const wall = utcToWallTime(nowDate(), shop.timezone);
  const thisMonth: MonthRef = { year: wall.year, month: wall.month };
  const month = requested === null ? thisMonth : parseMonthKey(requested);
  if (!month) return new Response("Expected month=YYYY-MM", { status: 400 });

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const input = await crewSheetForMonth(db, shop.id, shop.timezone, month);
  const csv = buildCrewSheetCsv({
    rows: assembleCrewSheet({ ...input, locale }),
    currency: toShopCurrency(shop.currency),
    /**
     * **The header row is localized**, unlike the full-shop bundle's (which
     * carries database column names, machine to machine) and the monthly
     * report's (fixed English). This file is different in kind: it is handed
     * to a person, and its *body* is already translated — the job words come
     * from the shop's own bundle and the unassigned line is a sentence — so an
     * English header on a Spanish sheet would be the one shape that reads
     * wrong in both languages.
     *
     * The numbers stay locale-independent for the same reason: hours and tips
     * are plain decimals in a fixed format, with the currency in its own
     * column, so the destination spreadsheet sums a column of `42.5` instead
     * of parsing `42,50 €` as text.
     */
    header: [
      t("settings.crewSheet.column.person"),
      t("settings.crewSheet.column.roles"),
      t("settings.crewSheet.column.departures"),
      t("settings.crewSheet.column.hours"),
      t("settings.crewSheet.column.tips"),
      t("settings.crewSheet.column.currency"),
    ],
    roleLabels: {
      instructor: t("trips.crew.roleInstructor"),
      divemaster: t("trips.crew.roleDivemaster"),
      captain: t("trips.crew.roleCaptain"),
      crew: t("trips.crew.roleCrew"),
    },
    roleUnspecifiedLabel: t("trips.crew.roleUnspecified"),
    unassignedLabel: t("settings.crewSheet.unassigned"),
    joinRoles: (roles) => cachedListFormat(locale, { type: "unit" }).format(roles),
  });

  return new Response(csv, {
    headers: {
      // `charset=utf-8` is load-bearing: crew names carry accents, and a
      // spreadsheet that guesses the encoding renders "Nuñez" as mojibake.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${crewSheetFileName(shop.slug, monthKey(month))}"`,
      "Cache-Control": "no-store",
    },
  });
}
