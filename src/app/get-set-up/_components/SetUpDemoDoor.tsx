import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import type { FunnelSource } from "@/lib/funnel";

/**
 * The demo, offered on the thank-you page to a reader waiting on a reply. It submits `enterDemoAction` like every other "Try the live
 * demo" (docs/product/marketing.md), at link weight, because each page's one
 * primary is its own. Same shape as `/onboard`'s door (`OnboardDemoDoor`),
 * with its own tag.
 */
export function SetUpDemoDoor({ t, source }: { t: DiverTranslator; source: FunnelSource }) {
  return (
    <div>
      <form action={enterDemoAction} className="contents">
        <FunnelTag source={source} />
        <SubmitButton
          pendingLabel={t("marketing.common.gettingReady")}
          className={buttonClass({ variant: "link", size: "sm", flush: true, className: "-my-3" })}
        >
          {t("marketing.common.tryDemo")}
        </SubmitButton>
      </form>
    </div>
  );
}
