import type { DbExecutor } from "@/db/client";
import { type CodeOutcome, shopPromoOutcomes } from "@/db/shop-promos";
import {
  type DealOutcome,
  lastMinuteDealOutcomes,
  type OutstandingLastMinutePromo,
} from "@/db/trip-promos";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz, formatMoneyCents } from "@/lib/format";
import { promoDiscountText } from "./PromoDiscountFields";
import type { TripDealRow } from "./PromoLedger";

/**
 * **What each deal and code sold** (fifth loop, item 28): "Sent to 8 divers ·
 * 2 booked · $142 in seats" and "Redeemed 3 times · $28.50 off $285 of
 * seats". Read for the page's own rows only, one query per list.
 */
export async function readPromoOutcomes(
  db: DbExecutor,
  shopId: string,
  codeIds: readonly string[],
  dealIds: readonly string[],
): Promise<{ codes: Map<string, CodeOutcome>; deals: Map<string, DealOutcome> }> {
  const [codes, deals] = await Promise.all([
    shopPromoOutcomes(db, shopId, codeIds),
    lastMinuteDealOutcomes(db, shopId, dealIds),
  ]);
  return { codes, deals };
}

/** A code's outcome line, or nothing before its first redemption. */
export function codeOutcomeFact(
  outcome: CodeOutcome | undefined,
  t: StaffTranslator,
  currency: string,
  locale: string,
): string | null {
  if (!outcome || outcome.ofCents <= 0) return null;
  return t("promos.outcome.code", {
    off: formatMoneyCents(outcome.offCents, currency, locale),
    of: formatMoneyCents(outcome.ofCents, currency, locale),
  });
}

/** The one-trip deals' rows, with what each sold beside who it was sent to. */
export function tripDealRows({
  deals,
  outcomes,
  shopSlug,
  t,
  currency,
  locale,
  timezone,
}: {
  deals: readonly OutstandingLastMinutePromo[];
  outcomes: Map<string, DealOutcome>;
  shopSlug: string;
  t: StaffTranslator;
  currency: string;
  locale: string;
  timezone: string;
}): TripDealRow[] {
  return deals.map((deal) => {
    const outcome = outcomes.get(deal.id);
    return {
      id: deal.id,
      code: deal.code,
      discount: promoDiscountText(t, deal, currency, locale),
      tripTitle: deal.tripTitle,
      href: `/shop/${shopSlug}/trips/${deal.tripId}?view=details#last-minute-deal`,
      facts: [
        t("promos.tripDeals.expiresAt", {
          date: formatDateTimeTz(deal.expiresAt, locale, timezone),
        }),
        t("promos.tripDeals.recipients", { count: deal.recipientCount }),
        t("promos.outcome.deal", {
          count: outcome?.seats ?? 0,
          amount: formatMoneyCents(outcome?.seatsCents ?? 0, currency, locale),
        }),
      ],
    };
  });
}
