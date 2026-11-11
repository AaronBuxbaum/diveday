import { Eyebrow } from "@/app/_components/Eyebrow";
import { MarketingHeroMotion } from "@/components/MarketingReveal";
import { CaptainPhoneFrame } from "@/components/MarketingSections";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/**
 * The home hero's second column: the captain's phone mid roll call, and the
 * card that overlaps its lower edge with the one fact a photo cannot show
 * (the roll call keeps working with no signal). Moved out of the route file
 * unchanged; `HomeBodySkeleton` draws the same two boxes.
 */
export function HomeHeroPhone({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <MarketingHeroMotion>
      <div className="mx-auto w-full max-w-sm lg:max-w-md">
        <CaptainPhoneFrame label={t("marketing.home.phoneFrameLabel")} locale={locale} />
        <div className="relative z-10 mx-auto -mt-5 w-[88%] rounded-inset border border-border bg-surface px-4 py-3">
          <Eyebrow>{t("marketing.home.dockEyebrow")}</Eyebrow>
          <p className="mt-1 text-sm font-medium">{t("marketing.home.dockDetail")}</p>
        </div>
      </div>
    </MarketingHeroMotion>
  );
}
