import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { DemoRoleId } from "@/lib/demo-roles";
import type { FunnelSource } from "@/lib/funnel";

/**
 * A screen's one door into the demo, as the role that screen belongs to. The
 * homepage's four screens each end in one (the doc that chose the voice:
 * "every screen ends in one door into the demo as that role"), and this is
 * the only place a marketing page submits `enterDemoAction` with a `role`
 * other than the owner's — the in-demo switcher is still where a visitor
 * changes role once inside.
 *
 * It is a link-weight control, deliberately: the funnel's primary is the
 * shared `FunnelCtas` pair, the door beside a screen is an aside to it, and a
 * primary-weight button on every screen would spend the hero's decision
 * budget four times over (docs/product/marketing.md, "One primary CTA per
 * screen"). The label names where the reader lands and as whom, and it is
 * not the site-wide "Try the live demo": that label is the generic door, and
 * this one is not generic.
 */
export function ScreenDoor({
  locale,
  demoRole,
  source,
  label,
}: {
  locale: DiverLocale;
  demoRole: DemoRoleId;
  source: FunnelSource;
  label: string;
}) {
  const t = diverTranslator(locale);
  return (
    <form action={enterDemoAction} className="contents">
      <FunnelTag source={source} />
      <input type="hidden" name="role" value={demoRole} />
      <SubmitButton
        pendingLabel={t("marketing.common.gettingReady")}
        className={buttonClass({ variant: "link", flush: true, className: "mt-2 self-start" })}
      >
        {label}
      </SubmitButton>
    </form>
  );
}
