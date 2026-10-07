import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { DemoLanding } from "@/lib/demo-landings";
import type { DemoRoleId } from "@/lib/demo-roles";
import { type FunnelSource, setUpHref } from "@/lib/funnel";

/**
 * The funnel's two doors, in the one order they are ever offered: **the demo
 * leads, getting set up follows** (Aaron, 2026-08-22 — issue #785;
 * docs/product/marketing.md, "The two doors, and which one leads").
 *
 * The second door is the set-up request form, not a sign-up: every shop is
 * opened by hand (ADR 20260925-shops-are-set-up-by-hand), so it asks to be set
 * up (ADR 20261007-setup-request-form). Both doors carry the funnel tag — the
 * demo in its form, the set-up door in its link — so `demo_entered` and
 * `setup_requested` read per page.
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
 * The one thing a page may say about the demo is *where it opens* (`demo`): a
 * feature page about the gear register opens it on the gear register, as the
 * role that page is about (`src/lib/feature-pages.ts`). That changes where
 * the reader lands, never how the pair looks or what it says, and a page that
 * passes nothing opens Today as the owner, as every door did before.
 *
 * Both buttons are `w-full sm:w-auto`. Without it the primary (inside a form,
 * hugging its label) rendered *narrower* than a stretched secondary link on
 * phones, making the demoted action the biggest target on first paint; and a
 * full-width button is the better wet-thumb target regardless.
 *
 * The row carries the same `w-full sm:w-auto`, because a percentage width
 * resolves against its container: with no width of its own the row took
 * whatever its caller's alignment left it, so on a phone the same primary
 * rendered full width in `/product`'s hero, 155px in its `items-center`
 * mid-page card and 158px in its `items-start` closing band. Below `sm` the
 * pair fills the column wherever it is placed.
 *
 * The `<form>` is `display: contents` so its button is a direct child of the
 * flex row and the two doors size and wrap as one pair.
 */
export function FunnelCtas({
  locale,
  source,
  demo,
  className,
}: {
  locale: DiverLocale;
  source: FunnelSource;
  /** Where the demo opens: as which role, on which staff page. Owner on Today when absent. */
  demo?: { role: DemoRoleId; landing: DemoLanding | null };
  /** Placement only — margins, `justify-*`, `shrink-0`. Never colour or weight. */
  className?: string;
}) {
  const t = diverTranslator(locale);
  const width = "w-full sm:w-auto";
  return (
    <div className={`flex ${width} flex-col gap-3 sm:flex-row${className ? ` ${className}` : ""}`}>
      <form action={enterDemoAction} className="contents">
        <FunnelTag source={source} />
        {demo ? <input type="hidden" name="role" value={demo.role} /> : null}
        {demo?.landing ? <input type="hidden" name="landing" value={demo.landing} /> : null}
        <SubmitButton
          pendingLabel={t("marketing.common.gettingReady")}
          className={buttonClass({ busy: true, className: width })}
        >
          {t("marketing.common.tryDemo")}
        </SubmitButton>
      </form>
      <Link
        href={setUpHref(source)}
        className={buttonClass({ variant: "outline", className: width })}
      >
        {t("marketing.common.getSetUp")}
      </Link>
    </div>
  );
}
