import type { Course } from "@/db/schema";
import type { DiverLocale } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import type { BuilderCourseOption } from "./builder-types";

export function builderCourseOptions(
  rows: Course[],
  shop: { currency: string | null } | null,
  locale: DiverLocale,
): BuilderCourseOption[] {
  const st = staffTranslator(locale);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    agency: row.agency,
    priceLabel:
      row.priceCents === null
        ? null
        : st("trips.details.coursePrice", {
            amount: formatMoneyCents(row.priceCents, toShopCurrency(shop?.currency), locale),
          }),
  }));
}
