import type { DbExecutor } from "@/db/client";
import { crewSheetForMonth } from "@/db/crew-sheet";
import { staffTranslator } from "@/i18n/staff-messages";
import { type MonthRef, monthKey } from "@/lib/calendar";
import { assembleCrewSheet, buildCrewSheetCsv, crewSheetFileName } from "@/lib/crew-sheet";
import { cachedListFormat } from "@/lib/intl-cache";
import { toShopCurrency } from "@/lib/money";

/**
 * **One month's crew sheet as a file**: what the Settings door downloads,
 * and the third of the month-end files the bookkeeper's email attaches (fifth
 * loop, item 35), built once so the two cannot drift.
 */
export async function crewSheetFile(
  db: DbExecutor,
  shop: { id: string; slug: string; timezone: string; currency: string },
  month: MonthRef,
  locale: string,
): Promise<{ fileName: string; csv: string }> {
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
  return { fileName: crewSheetFileName(shop.slug, monthKey(month)), csv };
}
