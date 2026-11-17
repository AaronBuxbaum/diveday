import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { DemoRoleId } from "@/lib/demo-roles";
import type { FunnelSource } from "@/lib/funnel";

const DOORS = [
  { role: "divemaster", source: "home-walk-desk", label: "doorDesk", note: "doorDeskNote" },
  { role: "captain", source: "home-walk-boat", label: "doorBoat", note: "doorBoatNote" },
  { role: "diver", source: "home-walk-diver", label: "doorDiver", note: "doorDiverNote" },
] as const satisfies readonly {
  role: DemoRoleId;
  source: FunnelSource;
  label: string;
  note: string;
}[];

/**
 * **The three doors under the walkthrough**, one per part of the day it just
 * showed: each opens the demo as the person who does that part (the desk's
 * divemaster, the boat's captain, the diver), so the reader lands on the
 * screen they were watching rather than on the owner's Today. They are the
 * outline weight, not the primary: the page's primary pair stays the hero's and
 * the close's (docs/product/marketing.md, "One primary CTA per screen").
 */
export function HomeWalkthroughDoors({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <div className="mt-12">
      <h3 className={`${BANNER_TITLE_CLASS} text-2xl`}>{t("marketing.home.walk.doorsTitle")}</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {DOORS.map(({ role, source, label, note }) => (
          <form key={role} action={enterDemoAction} className="flex flex-col gap-2">
            <FunnelTag source={source} />
            <input type="hidden" name="role" value={role} />
            <SubmitButton
              pendingLabel={t("marketing.common.gettingReady")}
              className={buttonClass({ variant: "outline", busy: true, className: "w-full" })}
            >
              {t(`marketing.home.walk.${label}`)}
            </SubmitButton>
            <p className="text-sm text-muted">{t(`marketing.home.walk.${note}`)}</p>
          </form>
        ))}
      </div>
    </div>
  );
}
