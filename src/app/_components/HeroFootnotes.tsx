import Link from "next/link";
import type { DiverTranslator } from "@/i18n/messages";
import { earlyAccessPrice } from "@/lib/marketing";
import { FIND_YOUR_BOOKING_PATH } from "@/lib/public-routes";

/**
 * The two quiet lines under the home hero's doors: the terms, for the shop
 * deciding, and the one way through for a diver who landed here by mistake.
 */
export function HeroFootnotes({ t }: { t: DiverTranslator }) {
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
        {t("marketing.home.heroPriceLine", {
          price: earlyAccessPrice.price,
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
