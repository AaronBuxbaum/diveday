import Link from "next/link";
import { type ClosingCtaMeasure, closingCtaBoxClass } from "@/app/_components/ClosingCtaSkeleton";
import { heroPriceLine } from "@/app/_components/hero-price-line";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS } from "@/components/ui/typography";
import { FOUNDER_EMAIL } from "@/features/public-site/company-identity";
import { type DiverMessageKey, diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import type { DemoLanding } from "@/lib/demo-landings";
import type { DemoRoleId } from "@/lib/demo-roles";
import { callHref, type FunnelSource, setUpHref } from "@/lib/funnel";
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
 * Home and Product heroes use a content-sized demo and quiet setup link (owner decision
 * 2026-10-26), keeping both doors on one wrapping row.
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
 * Outside Home and Product heroes, both buttons are `w-full sm:w-auto`. Without it the primary (inside a form,
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
 * renders what the demo costs and, when supplied, the price line. Every later pair is the two
 * buttons alone; the same two sentences had stood under seven pairs on four
 * pages. Who reads a set-up request is said once, in {@link ClosingCta}.
 */
export function FunnelCtas({
  locale,
  source,
  demo,
  footnotes = false,
  hero = false,
  call = false,
  setUp = true,
  className,
}: {
  locale: DiverLocale;
  source: FunnelSource;
  /** Where the demo opens: as which role, on which staff page. Owner on Today when absent. */
  demo?: { role: DemoRoleId; landing: DemoLanding | null };
  /**
   * The hero's pair only: the demo's cost and the price line under the doors.
   * Supply the pricing offer to show the price line; omit it for the homepage
   * demo note alone. Absent or `false` renders neither footnote.
   */
  footnotes?: false | { offer?: PlanTerms };
  /** Home and Product heroes keep the secondary setup door at quiet link weight. */
  hero?: boolean;
  /**
   * Offers the founder's 20-minute call beside Get set up, at quiet link weight. Every page's
   * closing band says so ({@link ClosingCta}), and a switching guide's concierge panel does in
   * place of a closing call; no other pair does, so the call appears once a page (Aaron,
   * 2026-11-17, after #4316).
   */
  call?: boolean;
  /**
   * `false` leaves Get set up out: a page whose concierge panel already carries it offers only
   * the demo here, so the reader is not asked for the same thing three times.
   */
  setUp?: boolean;
  /** Placement only — margins, `justify-*`, `shrink-0`. Never colour or weight. */
  className?: string;
}) {
  const t = diverTranslator(locale);
  const width = hero ? "w-auto" : "w-full sm:w-auto";
  return (
    <>
      <div
        className={`flex ${width} ${hero ? "flex-wrap items-center gap-x-6 gap-y-2" : "flex-col gap-3 sm:flex-row"}${className ? ` ${className}` : ""}`}
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
        {setUp ? (
          <Link
            href={setUpHref(source)}
            className={
              hero
                ? `${tapTargetLinkClass} font-medium text-primary hover:underline`
                : buttonClass({ variant: "outline", className: width })
            }
          >
            {t("marketing.common.getSetUp")}
          </Link>
        ) : null}
        {call ? (
          <a
            href={callHref(source)}
            target="_blank"
            rel="noreferrer"
            className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
          >
            {t("marketing.common.bookCall")}
          </a>
        ) : null}
      </div>
      {footnotes ? (
        <>
          <p className="mt-3 text-sm font-medium text-muted">{t("marketing.common.demoNote")}</p>
          {footnotes.offer ? (
            <p className="mt-2 text-sm text-muted">{heroPriceLine(t, footnotes.offer, locale)}</p>
          ) : null}
        </>
      ) : null}
    </>
  );
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
 * footer's) by default, so the close starts on the same left edge as every band
 * above it; a page that keeps a narrower column (`/switching`) passes
 * `measure="column"` for the same reason.
 */
export function ClosingCta({
  locale,
  source,
  title,
  demo,
  supportKey = "marketing.common.closingSupport",
  measure = "shell",
}: {
  locale: DiverLocale;
  source: FunnelSource;
  title: string;
  demo?: { role: DemoRoleId; landing: DemoLanding | null };
  /** The support line's bundle key; its sentence names `{email}`. */
  supportKey?: DiverMessageKey;
  /** The page's own column, so the close lines up with the bands above it. */
  measure?: ClosingCtaMeasure;
}) {
  const t = diverTranslator(locale);
  // The address is a link inside the bundle's sentence, so the sentence is
  // split on it rather than concatenated from fragments a translator cannot
  // reorder.
  const line = t(supportKey, { email: SUPPORT_EMAIL });
  const at = line.indexOf(SUPPORT_EMAIL);
  return (
    <section className="border-t border-border bg-surface">
      <div className={closingCtaBoxClass(measure)}>
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
        <FunnelCtas locale={locale} source={source} demo={demo} call className="mt-8" />
      </div>
    </section>
  );
}

/**
 * **The doors of `/hello`, the page the cold email links to** (2026-11-25), in
 * the email's own order: reply to the email first, then the founder's 20-minute
 * call, then (at the page's close only, `demo`) the live demo. It is the one
 * arrangement where the demo does not lead, because the reader arrived from a
 * personal note whose ask was a reply; a demo-first pair asked more of them
 * than the email did.
 *
 * The reply is a mail to the founder with a subject line already in it, and
 * the address is printed under the doors for a reader whose mail is in a
 * browser, where a `mailto:` link opens nothing. The
 * call carries the tag as `utm_content` and the demo posts it, so `hello` and
 * `hello-close` read in the Monday digest the way every other door does.
 */
export function ReplyFirstCtas({
  locale,
  source,
  demo = false,
  className,
}: {
  locale: DiverLocale;
  source: Extract<FunnelSource, "hello" | "hello-close">;
  /** The close offers the demo after the reply and the call. */
  demo?: boolean;
  /** Placement only: margins. */
  className?: string;
}) {
  const t = diverTranslator(locale);
  const mail = `mailto:${FOUNDER_EMAIL}?subject=${encodeURIComponent(t("marketing.hello.replySubject"))}`;
  return (
    <div className={className}>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
        <a href={mail} className={buttonClass({ className: "w-full sm:w-auto" })}>
          {t("marketing.hello.reply")}
        </a>
        <a
          href={callHref(source)}
          target="_blank"
          rel="noreferrer"
          className={buttonClass({ variant: "outline", className: "w-full sm:w-auto" })}
        >
          {t("marketing.common.bookCall")}
        </a>
        {demo ? (
          <form action={enterDemoAction} className="contents">
            <FunnelTag source={source} />
            <SubmitButton
              pendingLabel={t("marketing.common.gettingReady")}
              className={`${tapTargetLinkClass} font-medium text-primary hover:underline sm:ms-3`}
            >
              {t("marketing.common.tryDemo")}
            </SubmitButton>
          </form>
        ) : null}
      </div>
      <p className="mt-3 text-sm text-muted">
        {t("marketing.hello.replyAddress", { email: FOUNDER_EMAIL })}
      </p>
      {demo ? <p className="mt-1 text-sm text-muted">{t("marketing.common.demoNote")}</p> : null}
    </div>
  );
}
