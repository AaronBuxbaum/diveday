import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import type { FunnelSource } from "@/lib/funnel";

/**
 * The demo, offered on the thank-you page to a reader waiting on a reply. It
 * submits `enterDemoAction` like every other "Try the live demo"
 * (docs/product/marketing.md), because each page's one primary is its own.
 *
 * The demo opens with the name it generated; nothing is asked first.
 */
export function SetUpDemoDoor({ t, source }: { t: DiverTranslator; source: FunnelSource }) {
  return (
    <form action={enterDemoAction} className="flex w-full flex-col items-stretch gap-3 text-start">
      <FunnelTag source={source} />
      <SubmitButton
        pendingLabel={t("marketing.common.gettingReady")}
        className={buttonClass({ variant: "secondary" })}
      >
        {t("marketing.common.tryDemo")}
      </SubmitButton>
    </form>
  );
}
