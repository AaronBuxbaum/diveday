import { MarketingHeroMotion } from "@/components/MarketingReveal";
import { MarketingTryDesk } from "@/components/MarketingTryDesk";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/**
 * The home hero's second column: the arrival desk for the 7:30 trip, with its
 * buttons working. Two of the nine aren't ready, and the visitor clears them in
 * three taps. A sample held in the browser (`MarketingTryDesk`); the walkthrough
 * below follows the same desk through a day. `HomeBodySkeleton` draws its box.
 */
export function HomeHeroDesk({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <MarketingHeroMotion>
      <div className="mx-auto w-full max-w-md lg:max-w-lg">
        <MarketingTryDesk
          labels={{
            region: t("marketing.home.try.region"),
            hint: t("marketing.home.try.hint"),
            appBar: t("fallback.arrivalDesk.label"),
            hereOf: t("marketing.home.try.hereOf", { here: "{here}", expected: "{expected}" }),
            allHere: t("marketing.home.try.allHere"),
            stillToClear: t("fallback.arrivalDesk.stillToClear", { count: "{count}" }),
            ready: t("fallback.arrivalDesk.ready", { count: "{count}" }),
            checkedInGroup: t("fallback.arrivalDesk.checkedInGroup", { count: "{count}" }),
            heldReason: t("fallback.arrivalDesk.heldReason", {
              // i18n-exempt: sample diver names used only in marketing mockups
              bookedAs: "Mateo Rossi",
              // i18n-exempt: sample diver names used only in marketing mockups
              name: "Diego Alvarez",
            }),
            samePerson: t("fallback.arrivalDesk.samePerson"),
            differentPerson: t("fallback.arrivalDesk.differentPerson"),
            checkIn: t("fallback.arrivalDesk.checkIn"),
            checkedIn: t("fallback.arrivalDesk.checkedIn"),
            done: t("marketing.home.try.done"),
            restart: t("marketing.home.try.restart"),
          }}
        />
      </div>
    </MarketingHeroMotion>
  );
}
