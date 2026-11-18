import Image from "next/image";
import { MarketingBoatRollCall } from "@/components/MarketingBoatRollCall";
import { MarketingHeroMotion } from "@/components/MarketingReveal";
import { sectionCardClass } from "@/components/ui/card";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/** The final named response on a sample trip with nine divers and two crew. */
export function HomeHeroBoat({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <MarketingHeroMotion>
      <figure
        aria-label={t("marketing.home.boat.region")}
        className={sectionCardClass({
          padding: "none",
          className: "marketing-roll-call-frame mx-auto w-full max-w-md lg:max-w-lg",
        })}
      >
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
          <p className={ITEM_TITLE_CLASS}>{t("marketing.home.boat.title")}</p>
          <p className="text-sm text-muted">{t("marketing.home.boat.checkpoint")}</p>
        </div>
        <MarketingBoatRollCall
          poster={
            <Image
              src="/marketing/boat-roll-call.webp"
              width={1040}
              height={693}
              alt={t("marketing.home.boat.illustration")}
              sizes="(min-width: 1200px) 512px, (min-width: 1024px) 44vw, (min-width: 496px) 448px, calc(100vw - 48px)"
              loading="eager"
              className="aspect-[3/2] w-full object-cover"
            />
          }
          labels={{
            rotateLeft: t("marketing.home.boat.rotateLeft"),
            rotateRight: t("marketing.home.boat.rotateRight"),
            pause: t("marketing.home.boat.pause"),
            resume: t("marketing.home.boat.resume"),
            dragHint: t("marketing.home.boat.dragHint"),
            markerOpen: t("marketing.home.boat.markerOpen"),
            markerClosed: t("marketing.home.boat.markerClosed"),
            open: t("marketing.home.boat.open"),
            closed: t("marketing.home.boat.closed"),
            countOpen: t("marketing.home.boat.count", { aboard: 10 }),
            countClosed: t("marketing.home.boat.count", { aboard: 11 }),
            // i18n-exempt: sample diver name shared with the booking walkthrough
            name: "Priya Sharma",
            answered: t("marketing.home.boat.answered"),
            aboard: t("marketing.home.boat.aboard"),
            markAboard: t("marketing.home.boat.markAboard"),
            restart: t("marketing.home.boat.restart"),
          }}
        />
      </figure>
    </MarketingHeroMotion>
  );
}
