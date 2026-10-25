import Link from "next/link";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS } from "@/components/ui/typography";
import { type DiverMessageKey, type DiverTranslator, diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { planCopyParams } from "@/lib/billing/plan-display";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import type { DemoLanding } from "@/lib/demo-landings";
import type { DemoRoleId } from "@/lib/demo-roles";
import { type FunnelSource, setUpHref } from "@/lib/funnel";
import { earlyAccessPrice } from "@/lib/marketing";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";

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
 *
 * **The terms stand under the first pair on a page and nowhere else**
 * (visual review 2026-10-24, B09): `footnotes` is set only at a hero, where it
 * renders what the demo costs and the price line. Every later pair is the two
 * buttons alone; the same two sentences had stood under seven pairs on four
 * pages. Who reads a set-up request is said once, in {@link ClosingCta}.
 */
export function FunnelCtas({
  locale,
  source,
  demo,
  footnotes = false,
  className,
}: {
  locale: DiverLocale;
  source: FunnelSource;
  /** Where the demo opens: as which role, on which staff page. Owner on Today when absent. */
  demo?: { role: DemoRoleId; landing: DemoLanding | null };
  /**
   * The hero's pair only: the demo's cost and the price line under the doors.
   * Pass the reader's pricing offer (ADR 20261022-pricing-ab-test); absent or
   * `false` everywhere else.
   */
  footnotes?: false | { offer: PlanTerms };
  /** Placement only — margins, `justify-*`, `shrink-0`. Never colour or weight. */
  className?: string;
}) {
  const t = diverTranslator(locale);
  const width = "w-full sm:w-auto";
  return (
    <>
      <div
        className={`flex ${width} flex-col gap-3 sm:flex-row${className ? ` ${className}` : ""}`}
      >
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
      {footnotes ? (
        <>
          <p className="mt-3 text-sm font-medium text-muted">{t("marketing.common.demoNote")}</p>
          <p className="mt-2 text-sm text-muted">{heroPriceLine(t, footnotes.offer, locale)}</p>
        </>
      ) : null}
    </>
  );
}

/**
 * The price line under a hero's doors, per pricing arm (ADR
 * 20261022-pricing-ab-test). "No cut of your bookings" is the flat arm's alone.
 */
export function heroPriceLine(t: DiverTranslator, offer: PlanTerms, locale: string): string {
  const params = planCopyParams(offer, locale);
  return offer.plan === "percent_of_volume"
    ? t("marketing.home.percentArm.heroPriceLine", params)
    : t("marketing.home.heroPriceLine", {
        price: params.price,
        cadence: t(earlyAccessPrice.cadenceKey),
      });
}

/**
 * **The one close a marketing page ends on** (visual review 2026-10-24, B15):
 * a left-aligned heading saying what the shop gets, one line naming who reads
 * a set-up request and the support address, then the shared pair. `/`,
 * `/product`, each feature page, `/pricing`, `/about` and `/switching` each
 * had their own composition (centred with four lines, left with buttons right,
 * the support address three times, a tinted card); a page now passes only its
 * heading, its tag and where the demo opens. `/switching` also passes its own
 * support line, which carries the concierge offer the hub's separate card
 * used to close on, so that page closes once.
 *
 * The container is the marketing shell's (`max-w-7xl px-6`, the nav's and the
 * footer's), so the close starts on the same left edge as every band above it.
 */
export function ClosingCta({
  locale,
  source,
  title,
  demo,
  supportKey = "marketing.common.closingSupport",
}: {
  locale: DiverLocale;
  source: FunnelSource;
  title: string;
  demo?: { role: DemoRoleId; landing: DemoLanding | null };
  /** The support line's bundle key; its sentence names `{email}`. */
  supportKey?: DiverMessageKey;
}) {
  const t = diverTranslator(locale);
  // The address is a link inside the bundle's sentence, so the sentence is
  // split on it rather than concatenated from fragments a translator cannot
  // reorder.
  const line = t(supportKey, { email: SUPPORT_EMAIL });
  const at = line.indexOf(SUPPORT_EMAIL);
  return (
    <section className="border-t border-border bg-surface">
      <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
        <h2 className={`max-w-3xl ${BANNER_TITLE_CLASS} text-balance sm:text-4xl`}>{title}</h2>
        <p className="mt-4 max-w-2xl leading-7 text-muted">
          {at < 0 ? (
            line
          ) : (
            <>
              {line.slice(0, at)}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>
              {line.slice(at + SUPPORT_EMAIL.length)}
            </>
          )}
        </p>
        <FunnelCtas locale={locale} source={source} demo={demo} className="mt-8" />
      </div>
    </section>
  );
}
