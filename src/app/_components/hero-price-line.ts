import { planCopyParams } from "@/features/money/billing";
import type { DiverTranslator } from "@/i18n/messages";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import { earlyAccessPrice, marketingFee } from "@/lib/marketing";

/**
 * The price line under a hero's doors, for the configured offer (ADR
 * 20261022-pricing-ab-test). "No cut of your bookings" is the monthly-only offer’s alone.
 * Outside `FunnelCtas.tsx` so an e2e spec can expect the line its build's offer renders.
 */
export function heroPriceLine(t: DiverTranslator, offer: PlanTerms, locale: string): string {
  const params = planCopyParams(offer, locale);
  return offer.plan === "percent_of_volume"
    ? t(marketingFee.summaryKey, params)
    : t("marketing.home.heroPriceLine", {
        price: params.price,
        cadence: t(earlyAccessPrice.cadenceKey),
      });
}
