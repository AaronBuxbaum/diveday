import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import type { DiverTranslator } from "@/i18n/messages";
import { VISITOR_SHOP_NAME_MAX } from "@/lib/demo-identity";
import type { FunnelSource } from "@/lib/funnel";

/**
 * The demo, offered on the thank-you page to a reader waiting on a reply. It
 * submits `enterDemoAction` like every other "Try the live demo"
 * (docs/product/marketing.md), because each page's one primary is its own.
 *
 * **It asks for the reader's own shop name, optionally** (H-20261014-demo-wears-visitor-shop). Typed, the
 * demo's staff screens and its email preview wear it; blank, the demo keeps the
 * name it generated. The storefront never wears it. Nothing typed here is
 * stored: it rides in a cookie bound to the minted shop
 * (`src/lib/demo-shop-name.ts`). Its one line says what it is for (visual
 * review 2026-10-24, B45): a bare "optional" field before the demo read as a
 * form to fill in.
 */
export function SetUpDemoDoor({ t, source }: { t: DiverTranslator; source: FunnelSource }) {
  return (
    <form action={enterDemoAction} className="flex w-full flex-col items-stretch gap-3 text-start">
      <FunnelTag source={source} />
      <Field
        label={t("marketing.common.demoShopName")}
        hint={t("marketing.common.demoShopNameHint")}
      >
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
