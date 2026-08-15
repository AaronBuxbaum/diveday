import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { FunnelSource } from "@/lib/funnel";
import { trialHref } from "@/lib/funnel";
import { IMPORT_HONESTY_TABLE } from "@/lib/import";
import { fullShopExport } from "@/lib/marketing";
import { IMPORT_SCOPE_ROW_KEYS } from "@/lib/migration-guides";

/**
 * The one switching-guide composition, shared by the incumbent guides
 * (`/switching/[competitor]`) and the spreadsheet guide
 * (`/switching/spreadsheet`). Both pages used to be ~500-line siblings of the
 * same nine card-grid sections; these pieces are the guided path that replaced
 * them — you're here (hero, with the four answers a switcher arrives for) →
 * what changes → how the move works (one numbered rail, not three lookalike
 * "Step N" mega-sections) → proof (the scope table, grouped by outcome) →
 * talk to a human → act.
 *
 * Everything here renders inside a `"use cache"` page body, so nothing reads
 * request state: `locale` arrives as a prop, and the session-scoped import
 * deep-link arrives as a pass-through `importCta` slot (see each page's cache
 * comment). Copy is resolved by the caller or through `diverTranslator` —
 * strings never live here.
 */

/** The demo-then-trial CTA pair every switching page repeats at its exits. */
export function DemoTrialCtas({ locale, source }: { locale: DiverLocale; source: FunnelSource }) {
  const t = diverTranslator(locale);
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <form action={enterDemoAction} className="contents">
        <FunnelTag source={source} />
        <SubmitButton
          pendingLabel={t("switching.common.gettingDemoReady")}
          className={buttonClass({
            size: "cta",
            className: "cursor-pointer disabled:opacity-70",
          })}
        >
          {t("marketing.common.tryDemo")}
        </SubmitButton>
      </form>
      <Link
        href={trialHref(source)}
        className={buttonClass({
          variant: "secondary",
          size: "cta",
          className: "border-border-strong",
        })}
      >
        {t("marketing.common.startTrial")}
      </Link>
    </div>
  );
}

/**
 * The four questions a shop owner actually arrives on a switching guide with.
 * Every guide answers the same four, because all four are properties of the
 * importer and the switch rather than of any one incumbent — so they are one
 * shared key set, said once, in the first screenful. The fourth is the
 * *compressed* form of the return trip; the full claim and its terms stay in
 * the one shared `bothWays` block under the scope table (see `ScopePhase`),
 * never re-authored here.
 */
const GUIDE_FACTS = ["moves", "time", "preview", "back"] as const;

/**
 * The guide hero: back link, eyebrow, headline, lede, the buyer's first door
 * out — and {@link GUIDE_FACTS}, stated in the first screenful instead of
 * four to eight sections down.
 */
export function GuideHero({
  locale,
  source,
  eyebrow,
  title,
  lede,
}: {
  locale: DiverLocale;
  source: FunnelSource;
  eyebrow: string;
  title: string;
  lede: string;
}) {
  const t = diverTranslator(locale);
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
        <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
          {t("switching.common.backToGuides")}
        </Link>
        <p className="mt-6 text-sm font-semibold tracking-widest text-primary uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-5xl">
          {title}
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">{lede}</p>

        {/* The buyer's first door out of the page. Deliberately NOT the
            session-scoped `importCta` slot: that one deep-links a signed-in
            owner into their own shop's importer and is correct to disappear
            for the signed-out shopper this section is written for. */}
        <div className="mt-8">
          <DemoTrialCtas locale={locale} source={source} />
        </div>
        <p className="mt-3 text-sm text-muted">{t("switching.common.heroCtaNote")}</p>

        <dl className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-border pt-6 lg:grid-cols-4">
          {GUIDE_FACTS.map((fact) => (
            <div key={fact}>
              <dt className="text-xs font-semibold tracking-wider text-muted uppercase">
                {t(`switching.common.facts.${fact}.label`)}
              </dt>
              <dd className="mt-1 text-sm font-medium leading-6">
                {t(`switching.common.facts.${fact}.value`)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * The "you are here" step: the guide's own honest read of what the shop is
 * running today. Every other step on the path is announced — the coexist
 * section by its eyebrow, the mechanics by a numbered marker — and this one
 * was four unlabelled paragraphs, so a skimmer met a wall of body text with
 * nothing telling them what it was for.
 */
export function GuideContext({
  locale,
  paragraphs,
  children,
}: {
  locale: DiverLocale;
  paragraphs: string[];
  /** Anything the last paragraph leads into — the spreadsheet guide's wedge list. */
  children?: ReactNode;
}) {
  const t = diverTranslator(locale);
  return (
    <section className="mx-auto max-w-4xl px-6 py-14 lg:py-20">
      <p className="text-sm font-semibold tracking-widest text-primary uppercase">
        {t("switching.common.contextEyebrow")}
      </p>
      <div className="mt-5 max-w-2xl space-y-5">
        {paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-lg leading-8 text-muted">
            {paragraph}
          </p>
        ))}
      </div>
      {children}
    </section>
  );
}

/**
 * A two-column list divided by hairlines — the shape for "what changes":
 * the coexist guides' dive-day jobs and the spreadsheet guide's wedge. Six
 * bordered cards said "brochure"; six ruled entries read as one list of facts.
 */
export function DividedList({ items }: { items: { title: string; detail: string }[] }) {
  return (
    <ul className="mt-8 grid gap-x-10 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item.title} className="border-t border-border py-5">
          <h3 className="font-semibold leading-6">{item.title}</h3>
          <p className="mt-1.5 text-sm leading-6 text-muted">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * "How the move works" — the one section that holds the whole mechanical
 * path as a numbered rail of phases. This replaces the three separate
 * "Step 1 / Step 2 / Step 3" mega-sections whose identical dress chopped one
 * afternoon's work into what read as seven screens of process.
 */
export function MovePath({ locale, children }: { locale: DiverLocale; children: ReactNode }) {
  const t = diverTranslator(locale);
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
        <h2 className="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
          {t("switching.common.moveTitle")}
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
          {t("switching.common.moveIntro")}
        </p>
        <ol className="mt-12">{children}</ol>
      </div>
    </section>
  );
}

/**
 * One phase on the move rail: a numbered marker, a connecting line, a heading.
 *
 * `id` makes a phase a link target. A guide's move rail is the part of it
 * another page can usefully point *into* — the homepage's "Your spreadsheet,
 * column by column" promises the column table, which is the first phase of the
 * spreadsheet guide and three blocks below its hero, so without this the reader
 * lands on an argument about what a spreadsheet cannot do and reads the gap as
 * bait.
 *
 * The scroll offset that comes with it is deliberately generous — enough to
 * leave "How the move works" and its opening line on screen above the phase.
 * A reader arriving from another page has had no hero, and the marketing header
 * does not stick, so at a tight offset the whole first screen is a bare numeral,
 * a heading and a table with nothing on it naming the page or showing this is
 * step one of three. "Where am I" is a bad first beat for an owner who has been
 * burned by software before, however right the content under it is.
 */
export function MovePhase({
  id,
  number,
  title,
  intro,
  children,
}: {
  id?: string;
  number: number;
  title: string;
  intro?: string;
  children?: ReactNode;
}) {
  return (
    <li
      id={id}
      className={`group relative pb-14 pl-14 last:pb-0 sm:pl-16 ${id ? "scroll-mt-48" : ""}`}
    >
      <span
        aria-hidden
        className="absolute top-0 left-0 flex size-9 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-sm font-semibold text-primary"
      >
        {number}
      </span>
      <span
        aria-hidden
        className="absolute top-11 bottom-2 left-[1.125rem] w-px bg-border group-last:hidden"
      />
      <h3 className="pt-1 text-2xl font-semibold tracking-tight text-balance">{title}</h3>
      {intro && <p className="mt-3 max-w-2xl leading-7 text-muted">{intro}</p>}
      {children}
    </li>
  );
}

/** The ordered steps inside a phase — quiet numerals, title, one-line detail. */
export function StepList({ steps }: { steps: { title: string; detail: string }[] }) {
  return (
    <ol className="mt-6 space-y-5">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-muted tabular-nums"
          >
            {index + 1}
          </span>
          <div>
            <h4 className="font-semibold leading-6">{step.title}</h4>
            <p className="mt-1 text-sm leading-6 text-muted">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A phase's honest caveats — footnotes on a rule, not another bordered box. */
export function PhaseNotes({ notes }: { notes: string[] }) {
  return (
    <ul className="mt-8 max-w-2xl space-y-2 border-l-2 border-border pl-4 text-sm leading-6 text-muted">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

/**
 * The scope phase: IMPORT_HONESTY_TABLE verbatim, grouped by outcome so the
 * shared fact ("comes across" / "stays behind") is said once per group instead
 * of thirteen times as identical chips — then the same table read the other
 * way (the exit promise, composed from `fullShopExport`'s shared keys so this
 * page, the homepage band, and the pricing FAQ can never drift apart).
 */
export function ScopePhase({ locale, number }: { locale: DiverLocale; number: number }) {
  const t = diverTranslator(locale);
  const groups = [
    { scope: "included" as const, label: t("switching.common.comesAcross") },
    { scope: "stays-behind" as const, label: t("switching.common.staysBehind") },
  ];
  return (
    <MovePhase
      number={number}
      title={t("switching.common.scopeTableTitle")}
      intro={t("switching.common.scopeTableDescription")}
    >
      <div className="mt-8 space-y-8">
        {groups.map((group) => (
          <div key={group.scope}>
            {/* The shared fact, stated once for the group instead of as a
                chip on all thirteen rows (principles.md #9). No colour dot:
                the two words are the whole distinction, and a 6px speck of
                `--success` beside them was decoration pretending to be a
                signal. Set in the same small-caps as the hero's fact labels
                and the sources footnote, so one page has one voice for
                "this names what follows". */}
            <h4 className="text-xs font-semibold tracking-wider text-muted uppercase">
              {group.label}
            </h4>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {IMPORT_HONESTY_TABLE.filter((row) => row.scope === group.scope).map((row) => (
                <li
                  key={row.id}
                  className="grid gap-1 py-3 sm:grid-cols-[15rem_1fr] sm:items-baseline sm:gap-4"
                >
                  <span className="font-medium text-foreground">
                    {t(IMPORT_SCOPE_ROW_KEYS[row.id].what)}
                  </span>
                  <span className="text-sm leading-6 text-muted">
                    {t(IMPORT_SCOPE_ROW_KEYS[row.id].detail)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* The return trip, stated where the reader is weighing the one-way
          risk. The claim itself is never re-authored here. */}
      <div className="mt-10 max-w-2xl">
        <h4 className="text-lg font-semibold tracking-tight">
          {t("switching.common.bothWaysTitle")}
        </h4>
        <p className="mt-2 text-sm leading-6 text-muted">
          {t("switching.common.bothWaysBody", { claim: t(fullShopExport.claimKey) })}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">{t(fullShopExport.termsKey)}</p>
      </div>
    </MovePhase>
  );
}

/**
 * The import phase — identical on every guide because it is one importer.
 * `importerNote` is the single place a guide tailors it (a system that exports
 * certs separately, one that holds no cards at all); `importCta` is the
 * session-scoped deep link, kept behind its own Suspense so its per-visitor
 * content never enters the cached page body.
 */
export function ImportPhase({
  locale,
  number,
  importerNote,
  importCta,
}: {
  locale: DiverLocale;
  number: number;
  importerNote?: ReactNode;
  importCta: ReactNode;
}) {
  const t = diverTranslator(locale);
  const steps = [
    {
      title: t("switching.common.openSettingsTitle"),
      detail: t("switching.common.openSettingsBody"),
    },
    {
      title: t("switching.common.checkPreviewTitle"),
      detail: t("switching.common.checkPreviewBody"),
    },
    {
      title: t("switching.common.importReadyTitle"),
      detail: t("switching.common.importReadyBody"),
    },
  ];
  return (
    <MovePhase
      number={number}
      title={t("switching.common.bringFileTitle")}
      intro={t("switching.common.bringFileIntro")}
    >
      <StepList steps={steps} />
      {importerNote && (
        <p className="mt-8 max-w-2xl rounded-2xl border border-primary/30 bg-primary/5 p-5 text-sm leading-6 text-muted">
          {importerNote}
        </p>
      )}
      <Suspense fallback={null}>{importCta}</Suspense>
    </MovePhase>
  );
}

/**
 * The mid-page exit, at the hinge between the argument and the mechanics:
 * the reader has just been told what changes and is about to be handed a
 * thousand pixels of export click-path. "Rather see it than read about it?"
 * is exactly the offer that belongs there, and putting it here rather than
 * after the move rail keeps it from landing two screens from the closing
 * band's identical pair.
 */
export function MidCta({ locale, source }: { locale: DiverLocale; source: FunnelSource }) {
  const t = diverTranslator(locale);
  return (
    <section className="mx-auto max-w-4xl px-6 py-14 lg:py-16">
      {/* The panel is `SectionCard`, so every guide's hinge CTA is spelled the
          same as every other bordered panel in the app. The heading and body
          stay call-site children rather than `title`/`description`: this is a
          persuasion block, and `description` renders `text-sm`, which would
          quietly demote the one sentence standing between a reader and the
          demo. Chrome shared, marketing type scale kept. */}
      <SectionCard
        as="div"
        padding="lg"
        className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"
      >
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {t("switching.common.midCtaTitle")}
          </h2>
          <p className="mt-2 max-w-xl leading-7 text-muted">{t("switching.common.midCtaBody")}</p>
        </div>
        <div className="lg:shrink-0">
          <DemoTrialCtas locale={locale} source={source} />
        </div>
      </SectionCard>
    </section>
  );
}

/**
 * The closing band: title, one line, the CTA pair, and the way back to the hub.
 * `max-w-4xl` like every other section — it used to be `max-w-7xl`, so the
 * last thing on the page was also the one thing that started at a different
 * left edge from everything above it.
 */
export function ClosingCta({
  locale,
  source,
  title,
  body,
  backLabel,
}: {
  locale: DiverLocale;
  source: FunnelSource;
  title: string;
  body: string;
  backLabel: string;
}) {
  return (
    // `sm:shrink-0` on the action column: at `max-w-4xl` the prose was taking
    // the width it wanted and squeezing the buttons until "Try the live demo"
    // and "Start a trial" both broke across two lines mid-phrase.
    <section className="mx-auto flex max-w-4xl flex-col items-start justify-between gap-6 px-6 py-16 sm:flex-row sm:items-center lg:py-20">
      <div className="max-w-md">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">{title}</h2>
        <p className="mt-2 max-w-xl text-muted">{body}</p>
      </div>
      <div className="flex flex-col items-stretch gap-3 sm:shrink-0 sm:items-end">
        <DemoTrialCtas locale={locale} source={source} />
        <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
          {backLabel}
        </Link>
      </div>
    </section>
  );
}

/** The cited-sources footnote every incumbent guide carries (claims policy). */
export function SourcesFootnote({
  locale,
  sources,
}: {
  locale: DiverLocale;
  sources: { label: string; url: string }[];
}) {
  const t = diverTranslator(locale);
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">
          {t("switching.competitor.sources")}
        </h2>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm text-muted">
          {sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer nofollow"
                className="hover:text-foreground hover:underline"
              >
                {source.label} ↗
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
