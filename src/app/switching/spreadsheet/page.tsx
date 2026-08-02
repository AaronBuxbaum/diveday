import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { enterDemoAction } from "@/app/actions/demo";
import { FunnelTag } from "@/components/FunnelTag";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import { SubmitButton } from "@/components/SubmitButton";
import { SwitchingConcierge } from "@/components/SwitchingConcierge";
import { SwitchingImportCta } from "@/components/SwitchingImportCta";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { trialHref } from "@/lib/funnel";
import { IMPORT_HONESTY_TABLE } from "@/lib/import";

/**
 * "Coming from a spreadsheet" — the front door for the largest, most
 * under-served pool in the market: shops running the whole day on a spreadsheet
 * (and a clipboard). It sits under /switching with the incumbent guides, but it
 * is deliberately NOT one of them: a spreadsheet is not a vendor to leave, so
 * there is no incumbent to describe, no export click-path to reverse-engineer,
 * and no `sources`. The wedge here is not portability (they were never locked
 * in) — it is the things a spreadsheet cannot do: re-check a card at the dock,
 * run the day's blocker queue, let a diver book and sign without an account.
 *
 * Because that framing diverges from the incumbent template, this is its own
 * static route rather than a `migration-guides.ts` entry; a static segment wins
 * over the sibling `[competitor]` dynamic segment for this exact path. The one
 * shared invariant is honesty: the "what comes across" table renders
 * IMPORT_HONESTY_TABLE verbatim, the same source the importer and every
 * incumbent guide use, so the promise and the running code cannot drift.
 *
 * The concierge switch offer is a service commitment authorized by the product
 * owner (docs/product/marketing.md, claims policy) — not a product feature. It
 * is the shared `SwitchingConcierge` block, routed to the switch@dive.day inbox,
 * so a shop has a real handoff (in and out) on every switching page, not just
 * the self-service importer and export.
 */

export const metadata: Metadata = {
  title: "Move your dive shop off spreadsheets — DiveDay",
  description:
    "Running your dive shop from a spreadsheet? DiveDay reads the sheet you already keep — your divers, their cards, and their sizes — and adds the things a spreadsheet can't: readiness checked at the dock, the day's blocker queue, and booking and waivers your divers do themselves.",
  alternates: { canonical: "/switching/spreadsheet" },
};

export default function SpreadsheetSwitchPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<SpreadsheetBody locale={DEFAULT_DIVER_LOCALE} importCta={null} />}>
        <LocalizedSpreadsheetBody />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function LocalizedSpreadsheetBody() {
  const locale = await requestLocale();
  const t = diverTranslator(locale);
  return (
    <SpreadsheetBody
      locale={locale}
      importCta={<SwitchingImportCta label={t("switching.spreadsheet.openImportCta")} />}
    />
  );
}

/**
 * Cached per negotiated locale (DIVER_LOCALES — two entries). `importCta` carries
 * {@link SwitchingImportCta} (session-scoped — reads `auth()`) as a
 * pass-through slot per Next's `"use cache"` interleaving rules: it is never
 * read or invoked here, only rendered where it belongs in the tree, so its
 * per-visitor content never enters the cache entry.
 *
 * Its render site wraps `{importCta}` in its own `<Suspense>` — see the same
 * fix on the `[competitor]` guide's `GuideBody` for why: without it, this
 * preview's Cache Components runtime replayed a spurious "unique key"
 * warning on every request.
 */
async function SpreadsheetBody({
  locale,
  importCta,
}: {
  locale: DiverLocale;
  importCta: ReactNode;
}) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);

  const scopeChip: Record<
    (typeof IMPORT_HONESTY_TABLE)[number]["scope"],
    { label: string; className: string }
  > = {
    included: {
      label: t("switching.competitor.comesAcross"),
      className: "bg-success/10 text-success",
    },
    "stays-behind": {
      label: t("switching.competitor.staysBehind"),
      className: "bg-surface-sunken text-muted",
    },
  };

  /** The columns that matter, in the owner's words — mirrors what the importer recognizes. */
  const COLUMNS_THAT_MATTER: { column: string; detail: string }[] = [
    {
      column: t("switching.spreadsheet.columns.name.column"),
      detail: t("switching.spreadsheet.columns.name.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.email.column"),
      detail: t("switching.spreadsheet.columns.email.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.phone.column"),
      detail: t("switching.spreadsheet.columns.phone.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.emergencyContact.column"),
      detail: t("switching.spreadsheet.columns.emergencyContact.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.diveInsurance.column"),
      detail: t("switching.spreadsheet.columns.diveInsurance.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.certification.column"),
      detail: t("switching.spreadsheet.columns.certification.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.refresherDue.column"),
      detail: t("switching.spreadsheet.columns.refresherDue.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.specialty.column"),
      detail: t("switching.spreadsheet.columns.specialty.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.nitrox.column"),
      detail: t("switching.spreadsheet.columns.nitrox.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.rentalSizes.column"),
      detail: t("switching.spreadsheet.columns.rentalSizes.detail"),
    },
    {
      column: t("switching.spreadsheet.columns.pastVisits.column"),
      detail: t("switching.spreadsheet.columns.pastVisits.detail"),
    },
  ];

  const wedgeItems = [
    {
      title: t("switching.spreadsheet.wedge.cardsChecked.title"),
      body: t("switching.spreadsheet.wedge.cardsChecked.body"),
    },
    {
      title: t("switching.spreadsheet.wedge.blockersOnePlace.title"),
      body: t("switching.spreadsheet.wedge.blockersOnePlace.body"),
    },
    {
      title: t("switching.spreadsheet.wedge.diversBookThemselves.title"),
      body: t("switching.spreadsheet.wedge.diversBookThemselves.body"),
    },
    {
      title: t("switching.spreadsheet.wedge.manifestHeadCount.title"),
      body: t("switching.spreadsheet.wedge.manifestHeadCount.body"),
    },
  ];

  return (
    <main className="flex-1">
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
          <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
            {t("switching.spreadsheet.backToGuides")}
          </Link>
          <p className="mt-6 text-sm font-semibold tracking-widest text-primary uppercase">
            {t("switching.spreadsheet.eyebrow")}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-5xl">
            {t("switching.spreadsheet.title")}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">
            {t("switching.spreadsheet.heroLede")}
          </p>

          {/* The buyer's first door out of the page, before the wedge, the
              columns list, and the scope table. Not the `importCta` slot —
              that one deep-links a signed-in owner into their own shop's
              importer and is correct to disappear for a signed-out shopper.
              Nothing here reads the session, so it stays inside the cached
              body. */}
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <form action={enterDemoAction} className="contents">
              <FunnelTag source="switching-spreadsheet" />
              <SubmitButton
                pendingLabel={t("switching.spreadsheet.gettingDemoReady")}
                className={buttonClass({
                  size: "cta",
                  className: "cursor-pointer disabled:opacity-70",
                })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref("switching-spreadsheet")}
              className={buttonClass({
                variant: "secondary",
                size: "cta",
                className: "border-border-strong",
              })}
            >
              {t("marketing.common.startTrial")}
            </Link>
          </div>
          <p className="mt-3 text-sm text-muted">{t("switching.common.heroCtaNote")}</p>
        </div>
      </section>

      {/* The wedge: what a spreadsheet fundamentally can't do. */}
      <section className="mx-auto max-w-4xl px-6 py-14 lg:py-20">
        <div className="max-w-2xl space-y-5">
          <p className="text-lg leading-8 text-muted">{t("switching.spreadsheet.wedgeIntro1")}</p>
          <p className="text-lg leading-8 text-muted">{t("switching.spreadsheet.wedgeIntro2")}</p>
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {wedgeItems.map((item) => (
            <li key={item.title} className="rounded-2xl border border-border bg-surface p-6">
              <h3 className="font-semibold leading-6">{item.title}</h3>
              <p className="mt-2 leading-7 text-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Step 1: ready the sheet you already have. */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("switching.spreadsheet.step1")}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("switching.spreadsheet.columnsTitle")}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
            {t("switching.spreadsheet.columnsIntro")}
          </p>

          <div className="mt-8">
            <a
              href="/diveday-diver-import-template.csv"
              download
              className={buttonClass({ variant: "secondary", className: "border-border-strong" })}
            >
              {t("switching.spreadsheet.downloadTemplate")}
            </a>
          </div>

          <ul className="mt-10 divide-y divide-border border-y border-border">
            {COLUMNS_THAT_MATTER.map((row) => (
              <li
                key={row.column}
                className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:items-baseline sm:gap-3"
              >
                <span className="font-medium text-foreground">{row.column}</span>
                <span className="text-sm leading-6 text-muted">{row.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Step 2: the scope table — the importer's own honesty table, verbatim. */}
      <section className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">
          {t("switching.spreadsheet.step2")}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
          {t("switching.spreadsheet.scopeTableTitle")}
        </h2>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
          {t("switching.spreadsheet.scopeTableDescription")}
        </p>

        <ul className="mt-8 space-y-2">
          {IMPORT_HONESTY_TABLE.map((row) => (
            <li
              key={row.what}
              className="grid gap-1 rounded-xl border border-border bg-surface px-4 py-3 sm:grid-cols-[11rem_7rem_1fr] sm:items-baseline sm:gap-3"
            >
              <span className="font-medium text-foreground">{row.what}</span>
              <span>
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${scopeChip[row.scope].className}`}
                >
                  {scopeChip[row.scope].label}
                </span>
              </span>
              <span className="text-sm leading-6 text-muted">{row.detail}</span>
            </li>
          ))}
        </ul>

        {/* The scope table is where a reader decides the move is real — and it
            was the furthest point they could reach without a way to act. */}
        <div className="mt-10 flex flex-col gap-6 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-semibold tracking-tight">
              {t("switching.common.midCtaTitle")}
            </h3>
            <p className="mt-2 max-w-xl leading-7 text-muted">{t("switching.common.midCtaBody")}</p>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:shrink-0 sm:flex-row sm:items-center">
            <form action={enterDemoAction} className="contents">
              <FunnelTag source="switching-spreadsheet" />
              <SubmitButton
                pendingLabel={t("switching.spreadsheet.gettingDemoReady")}
                className={buttonClass({
                  size: "cta",
                  className: "cursor-pointer disabled:opacity-70",
                })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref("switching-spreadsheet")}
              className={buttonClass({
                variant: "secondary",
                size: "cta",
                className: "border-border-strong",
              })}
            >
              {t("marketing.common.startTrial")}
            </Link>
          </div>
        </div>
      </section>

      {/* Step 3: bring the file into DiveDay. */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("switching.spreadsheet.step3")}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("switching.spreadsheet.bringFileTitle")}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
            {t("switching.spreadsheet.bringFileIntro")}
          </p>
          <ol className="mt-10 space-y-6">
            <li className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                1
              </span>
              <div className="pt-1">
                <h3 className="font-semibold leading-6">
                  {t("switching.spreadsheet.openSettingsTitle")}
                </h3>
                <p className="mt-1.5 leading-7 text-muted">
                  {t("switching.spreadsheet.openSettingsBody")}
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                2
              </span>
              <div className="pt-1">
                <h3 className="font-semibold leading-6">
                  {t("switching.spreadsheet.checkPreviewTitle")}
                </h3>
                <p className="mt-1.5 leading-7 text-muted">
                  {t("switching.spreadsheet.checkPreviewBody")}
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                3
              </span>
              <div className="pt-1">
                <h3 className="font-semibold leading-6">
                  {t("switching.spreadsheet.importReadyTitle")}
                </h3>
                <p className="mt-1.5 leading-7 text-muted">
                  {t("switching.spreadsheet.importReadyBody")}
                </p>
              </div>
            </li>
          </ol>

          <Suspense fallback={null}>{importCta}</Suspense>
        </div>
      </section>

      {/* The owner-authorized concierge switch offer (shared across /switching). */}
      <SwitchingConcierge locale={locale} />

      <section className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-16 sm:flex-row sm:items-center lg:py-20">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {t("switching.spreadsheet.closingTitle")}
          </h2>
          <p className="mt-2 max-w-xl text-muted">
            {t("switching.spreadsheet.closingDescription")}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-col gap-3 sm:flex-row">
            <form action={enterDemoAction} className="contents">
              <FunnelTag source="switching-spreadsheet" />
              <SubmitButton
                pendingLabel={t("switching.spreadsheet.gettingDemoReady")}
                className={buttonClass({
                  size: "cta",
                  className: "cursor-pointer disabled:opacity-70",
                })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref("switching-spreadsheet")}
              className={buttonClass({
                variant: "secondary",
                size: "cta",
                className: "border-border-strong",
              })}
            >
              {t("marketing.common.startTrial")}
            </Link>
          </div>
          <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
            {t("switching.spreadsheet.otherSystems")}
          </Link>
        </div>
      </section>
    </main>
  );
}
