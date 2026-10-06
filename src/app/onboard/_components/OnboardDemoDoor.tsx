import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * `/onboard`'s footer line offering the demo, on both faces of the page (the
 * closed door and the keyed form). It submits `enterDemoAction`, because the
 * site-wide "Try the live demo" names exactly one action everywhere it
 * appears (docs/product/marketing.md); until issue #1956 it was a link to `/`,
 * which sent a visitor back to the homepage to find the demo again.
 *
 * Link weight, never the primary variant: the page's one primary is its own
 * mail or "Create shop & start trial", and this is the aside the nav's hidden
 * CTA would otherwise have been. It is a `<div>`, not the `<p>` the link sat
 * in, because a `<form>` may not be a descendant of a paragraph. The `-my-3`
 * is the 44px target reaching past the line, the same trade the footer's
 * links make (`EntryShell`'s `FOOTER_LINK_SLOT`).
 */
export function OnboardDemoDoor({ t }: { t: DiverTranslator }) {
  return (
    <div>
      {t("account.onboard.demoNote")}{" "}
      <form action={enterDemoAction} className="contents">
        <FunnelTag source="onboard-demo" />
        <SubmitButton
          pendingLabel={t("marketing.common.gettingReady")}
          className={buttonClass({ variant: "link", size: "sm", flush: true, className: "-my-3" })}
        >
          {t("account.onboard.tryLiveDemo")}
        </SubmitButton>
      </form>
    </div>
  );
}
