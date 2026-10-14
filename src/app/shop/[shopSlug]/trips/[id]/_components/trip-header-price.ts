import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyScanned } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";

/**
 * The trip header's price: the scanned form and the editor's own unit, as the
 * board and the public hero print it, "$95 per diver" (third review, item 7).
 * Nothing for a departure with no price set.
 */
export function tripHeaderPrice(
  priceCents: number | null,
  currency: string,
  locale: string,
  t: StaffTranslator,
): string | undefined {
  if (priceCents === null) return undefined;
  return `${formatMoneyScanned(priceCents, toShopCurrency(currency), locale)} ${t("trips.about.perDiver")}`;
}
