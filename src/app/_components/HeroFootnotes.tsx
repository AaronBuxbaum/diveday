import Link from "next/link";
import type { DiverTranslator } from "@/i18n/messages";
import { planCopyParams } from "@/lib/billing/plan-display";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import { earlyAccessPrice } from "@/lib/marketing";
import { FIND_YOUR_BOOKING_PATH } from "@/lib/public-routes";

/**
 * The two quiet lines under the home hero's doors: the terms, for the shop
 * deciding, and the one way through for a diver who landed here by mistake.
 */
export function HeroFootnotes({
  t,
  offer,
  locale,
}: {
  t: DiverTranslator;
  /** The reader's pricing arm and its numbers (ADR 20261022-pricing-ab-test). */
  offer: PlanTerms;
  locale: string;
}) {
  const params = planCopyParams(offer, locale);
  return (
    <>
      {/* The terms, standing at the door rather than four bands below it
          (docs/product/marketing-review-20260827.md, diagnosis 2). It is
          deliberately a sentence and not a third CTA: the hero's decision
          density is pinned at one primary and one secondary, and a
          "See pricing" link here would spend that budget to answer a
          question this line already answers. The closing band keeps the
          two-year-lock detail and the door to /pricing. */}
      <p className="mt-2 text-sm text-muted">
        {/* "No cut of your bookings" is the flat arm's alone. */}
        {offer.plan === "percent_of_volume"
          ? t("marketing.home.percentArm.heroPriceLine", params)
          : t("marketing.home.heroPriceLine", {
              price: params.price,
              cadence: t(earlyAccessPrice.cadenceKey),
            })}
      </p>
      {/* **The one line for a diver** (fourth review, item 50). Every
          shop footer says "Bookings by DiveDay" and links here, so a
          diver who lost their link lands on a page for shop owners. A
          sentence, not a button: the hero's one primary and one secondary
          stay the shop's, and this is a way through, not a pitch. */}
      <p className="mt-6 text-sm text-muted">
        {t("marketing.home.diverDoor")}{" "}
        <Link
          href={FIND_YOUR_BOOKING_PATH}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("marketing.home.diverDoorLink")}
        </Link>
      </p>
    </>
  );
}

/**
 * The home page's closing price line, per pricing arm (ADR
 * 20261022-pricing-ab-test): the flat arm's is today's, word for word.
 */
export function closingPriceLine(t: DiverTranslator, offer: PlanTerms, locale: string): string {
  const params = planCopyParams(offer, locale);
  return offer.plan === "percent_of_volume"
    ? t("marketing.home.percentArm.priceLine", params)
    : t("marketing.home.priceLine", {
        price: params.price,
        cadence: t(earlyAccessPrice.cadenceKey),
      });
}
