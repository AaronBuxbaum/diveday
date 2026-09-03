import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { type FunnelSource, trialHref } from "@/lib/funnel";

/**
 * The funnel's two doors, in the one order they are ever offered: **the demo
 * leads, the trial follows** (Aaron, 2026-08-22 — issue #785;
 * docs/product/marketing.md, "The two doors, and which one leads").
 *
 * It exists because the arrangement is a property of the *funnel* and every
 * page had been deciding it alone. Each page was written as a page and reviewed
 * as a page, which is the right unit for copy and the wrong one for hierarchy:
 * `/` led with the demo, `/pricing` swapped the weights under the same two
 * labels, and `/pricing`'s closing band dropped the demo entirely at the moment
 * a reader who had just read the whole price page was warmest. Nothing was
 * wrong on any one page, which is exactly why nothing caught it.
 *
 * So order, weight, labels, the pending label and the funnel tag are decided
 * here and are not props. A page chooses only where the pair sits and how big
 * it is — the same move `src/lib/staff-destinations.ts` made for the staff nav,
 * for the same reason: a new page cannot invent a third arrangement without
 * editing this file, where the decision is written down.
 *
 * Both buttons are `w-full sm:w-auto`. Without it the primary (inside a form,
 * hugging its label) rendered *narrower* than a stretched secondary link on
 * phones, making the demoted action the biggest target on first paint; and a
 * full-width button is the better wet-thumb target regardless.
 *
 * The `<form>` is `display: contents` so its button is a direct child of the
 * flex row and the two doors size and wrap as one pair.
 */
export function FunnelCtas({
  locale,
  source,
  className,
}: {
  locale: DiverLocale;
  source: FunnelSource;
  /** Placement only — margins, `justify-*`, `shrink-0`. Never colour or weight. */
  className?: string;
}) {
  const t = diverTranslator(locale);
  const width = "w-full sm:w-auto";
  return (
    <div className={`flex flex-col gap-3 sm:flex-row${className ? ` ${className}` : ""}`}>
      <form action={enterDemoAction} className="contents">
        <FunnelTag source={source} />
        <SubmitButton
          pendingLabel={t("marketing.common.gettingReady")}
          className={buttonClass({ busy: true, className: width })}
        >
          {t("marketing.common.tryDemo")}
        </SubmitButton>
      </form>
      <Link
        href={trialHref(source)}
        className={buttonClass({
          variant: "secondary",
          className: `border-border-strong ${width}`,
        })}
      >
        {t("marketing.common.startTrial")}
      </Link>
    </div>
  );
}
