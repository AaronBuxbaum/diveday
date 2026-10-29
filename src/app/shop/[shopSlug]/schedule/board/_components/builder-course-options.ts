import type { Course } from "@/db/schema";
import type { DiverLocale } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { type CoursePricing, perDiverBookingPriceCents } from "@/lib/courses";
import { formatMoneyCents } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import type { BuilderCourseOption } from "./builder-types";

export function builderCourseOptions(
  rows: (Pick<Course, "id" | "agency"> & CoursePricing)[],
  shop: { currency: string | null } | null,
  locale: DiverLocale,
): BuilderCourseOption[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    agency: row.agency,
    priceLabel: builderCoursePriceLabel(row, shop, locale),
  }));
}

export function builderCoursePriceLabel(
  course: CoursePricing,
  shop: { currency: string | null } | null,
  locale: DiverLocale,
): string | null {
  // The trip input remains the fallback for a course without an instruction
  // price. Once one is set, show the checkout total, including eLearning.
  if (course.priceCents === null) return null;
  const totalCents = perDiverBookingPriceCents({ priceCents: null }, course);
  if (totalCents === null) return null;
  return staffTranslator(locale)("trips.details.coursePrice", {
    amount: formatMoneyCents(totalCents, toShopCurrency(shop?.currency), locale),
  });
}
