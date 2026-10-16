import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import type { DiverTranslator } from "@/i18n/messages";
import type { FunnelSource } from "@/lib/funnel";
import { VISITOR_SHOP_NAME_MAX } from "@/lib/demo-identity";

/**
 * The demo, offered on the thank-you page to a reader waiting on a reply. It
 * submits `enterDemoAction` like every other "Try the live demo"
 * (docs/product/marketing.md), because each page's one primary is its own.
 *
 * **It asks for the reader's own shop name, optionally** (H-131). Typed, the
 * demo's staff screens and its email preview wear it; blank, the demo keeps the
 * name it generated. The storefront never wears it. Nothing typed here is
 * stored: it rides in a cookie bound to the minted shop
 * (`src/lib/demo-shop-name.ts`).
 */
export function SetUpDemoDoor({ t, source }: { t: DiverTranslator; source: FunnelSource }) {
  return (
    <form action={enterDemoAction} className="flex w-full flex-col items-stretch gap-3 text-start">
      <FunnelTag source={source} />
      <Field label={t("marketing.common.demoShopName")} hint={t("common.optional")}>
        <input
          type="text"
          name="shopName"
          autoComplete="organization"
          maxLength={VISITOR_SHOP_NAME_MAX}
          className={controlClass}
        />
      </Field>
      <SubmitButton
        pendingLabel={t("marketing.common.gettingReady")}
        className={buttonClass({ variant: "secondary" })}
      >
        {t("marketing.common.tryDemo")}
      </SubmitButton>
    </form>
  );
}
