import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { guideSource, trialHref } from "@/lib/funnel";
import { IMPORT_HONESTY_TABLE } from "@/lib/import";
import { fullShopExport, sharedLinkCard } from "@/lib/marketing";
import {
  getMigrationGuide,
  IMPORT_SCOPE_ROW_KEYS,
  MIGRATION_GUIDE_SLUGS,
  type MigrationGuide,
} from "@/lib/migration-guides";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
export const instant = true;

// Only the registered guides are valid routes; an unknown competitor 404s via
// the `notFound()` call below — `dynamicParams` is not compatible with
// Cache Components (nextConfig.cacheComponents), so the 404 for an
// unregistered slug is enforced in the page body instead of this config.
export function generateStaticParams() {
  return MIGRATION_GUIDE_SLUGS.map((competitor) => ({ competitor }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const { competitor } = await params;
  const guide = getMigrationGuide(competitor);
  if (!guide) return { title: "Switching to DiveDay" };
  // Fixed to the default locale, like the hub page's static `metadata`:
  // negotiating here would read request headers inside `generateMetadata` and
  // cost the registered slugs their prerendered shells.
  const t = diverTranslator(DEFAULT_DIVER_LOCALE);
  const title = `${t(guide.metaTitle)} — DiveDay`;
  const description = t(guide.metaDescription);
  return {
    title,
    description,
    alternates: { canonical: `/switching/${guide.slug}` },
    openGraph: {
      ...sharedLinkCard,
      title,
      description,
      url: `/switching/${guide.slug}`,
    },
    // `summary_large_image`: the OG block above names the shared link card
    // (`sharedLinkCard` → `src/app/opengraph-image.tsx`) for every registered
    // guide — docs/product/marketing.md, Twitter-card policy. Built from the
    // same two strings as the OG block so a guide can never unfurl one story on
    // one network and another elsewhere.
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function MigrationGuidePage({
  params,
}: {
  params: Promise<{ competitor: string }>;
}) {
  // Resolved and checked here, before any Suspense boundary starts streaming
  // the shell: `notFound()` only changes the response's HTTP status if it
  // throws before the first byte goes out. Called from inside a
  // Suspense-wrapped child instead (as this used to), the shell had already
  // streamed with a 200 by the time the child resolved and rendered its
  // not-found UI, so the page LOOKED right but answered a request for an
  // unregistered competitor with status 200, not 404 — caught by
  // e2e/marketing.spec.ts's `expect(response?.status()).toBe(404)`. Resolving
  // `params` here doesn't cost this route its static shell for a *registered*
  // slug: `generateStaticParams` still prerenders each one at build time, and
  // this lookup is a synchronous in-memory match against
  // `MIGRATION_GUIDE_SLUGS`, not a dynamic API call.
  const { competitor } = await params;
  const guide = getMigrationGuide(competitor);
  if (!guide) notFound();
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<main className="flex-1" />}>
        <LocalizedGuideBody guide={guide} />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function LocalizedGuideBody({ guide }: { guide: MigrationGuide }) {
  const locale = await requestLocale();
  const t = diverTranslator(locale);
  return (
    <GuideBody
      locale={locale}
      guide={guide}
      importCta={<SwitchingImportCta label={t("switching.competitor.openImportCta")} />}
    />
  );
}

/**
 * Cached per (negotiated locale, guide) — `guide` is a plain, serializable
 * data object (`src/lib/migration-guides.ts`), safe as a `"use cache"`
 * argument. `importCta` carries {@link SwitchingImportCta} (session-scoped —
 * reads `auth()`) as a pass-through slot per Next's interleaving rules: never
 * read or invoked here, only rendered where it belongs, so its per-visitor
 * content never enters the cache entry.
 *
 * Its own render site wraps `{importCta}` in a `<Suspense>` (see below) —
 * without one, this preview's Cache Components runtime replayed a spurious
 * "unique key" warning on every request that reached this cached body,
 * because the dynamic child was streaming into a cache boundary with no
 * boundary of its own to resolve against. Isolating the dynamic read behind
 * its own `<Suspense>`, per the Next migrating-to-cache-components guide, is
 * what stopped it — confirmed by removing `importCta` entirely (warning
 * gone) and then restoring it wrapped (still gone, button still renders).
 */
async function GuideBody({
  locale,
  guide,
  importCta,
}: {
  locale: DiverLocale;
  guide: MigrationGuide;
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

  return (
    <main className="flex-1">
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
          <Link href="/switching" className="text-sm font-medium text-primary hover:underline">
            {t("switching.competitor.backToGuides")}
          </Link>
          <p className="mt-6 text-sm font-semibold tracking-widest text-primary uppercase">
            {t(guide.heroEyebrow)}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-balance sm:text-5xl">
            {t(guide.heroTitle)}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted">{t(guide.heroLede)}</p>

          {/* The buyer's first door out of the page, before six sections of
              export click-path and scope table. Deliberately NOT the
              `importCta` slot: that one deep-links a signed-in owner into
              their own shop's importer and is correct to disappear for the
              signed-out shopper this section is written for. Nothing here
              reads the session, so it stays inside the cached body. */}
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <form action={enterDemoAction} className="contents">
              <FunnelTag source={guideSource(guide.slug)} />
              <SubmitButton
                pendingLabel={t("switching.competitor.gettingDemoReady")}
                className={buttonClass({
                  size: "cta",
                  className: "cursor-pointer disabled:opacity-70",
                })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref(guideSource(guide.slug))}
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

      {/* Honest framing of the incumbent. */}
      <section className="mx-auto max-w-4xl px-6 py-14 lg:py-20">
        <div className="max-w-2xl space-y-5">
          {guide.context.map((paragraph) => (
            <p key={paragraph} className="text-lg leading-8 text-muted">
              {t(paragraph)}
            </p>
          ))}
        </div>
      </section>

      {/* Coexist framing: for a booking channel a shop keeps (FareHarbor),
            the "keep the storefront, we run the water" division of labor, plus
            the honest alternative of leaving. Absent for the leave-it guides. */}
      {guide.coexist && (
        <section className="border-y border-border">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("switching.competitor.keepOrLeaveEyebrow")}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
              {t(guide.coexist.heading)}
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">{t(guide.coexist.intro)}</p>

            <ul className="mt-10 grid gap-5 sm:grid-cols-2">
              {/* Shared messages — two of them interpolate the competitor's name. */}
              {guide.coexist.runsInDiveDay.map((item) => (
                <li key={item.title} className="rounded-2xl border border-border bg-surface p-6">
                  <h3 className="font-semibold leading-6">{t(item.title)}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {t(item.detail, { competitor: guide.competitor })}
                  </p>
                </li>
              ))}
            </ul>

            <p className="mt-8 max-w-2xl leading-7 text-muted">{t(guide.coexist.bridgeNote)}</p>

            <div className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-6">
              <h3 className="text-lg font-semibold tracking-tight">
                {t(guide.coexist.replace.heading)}
              </h3>
              <p className="mt-2 leading-7 text-muted">{t(guide.coexist.replace.body)}</p>
            </div>
          </div>
        </section>
      )}

      {/* Step 1: export from the incumbent (files the shop makes itself). */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            {t("switching.competitor.step1")}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t(guide.exportHeading)}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">{t(guide.exportIntro)}</p>

          <ol className="mt-10 space-y-6">
            {guide.exportSteps.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <div className="pt-1">
                  <h3 className="font-semibold leading-6">{t(step.title)}</h3>
                  <p className="mt-1.5 leading-7 text-muted">{t(step.detail)}</p>
                </div>
              </li>
            ))}
          </ol>

          {guide.exportNotes.length > 0 && (
            <ul className="mt-10 space-y-3 rounded-2xl border border-border bg-background p-6 text-sm leading-6 text-muted">
              {guide.exportNotes.map((note) => (
                <li key={note} className="flex gap-3">
                  <span aria-hidden className="font-semibold text-primary">
                    •
                  </span>
                  <span>{t(note)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Step 2: the scope table — the importer's own honesty table, verbatim. */}
      <section className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">
          {t("switching.competitor.step2")}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
          {t("switching.competitor.scopeTableTitle")}
        </h2>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
          {t("switching.competitor.scopeTableDescription")}
        </p>

        <ul className="mt-8 space-y-2">
          {IMPORT_HONESTY_TABLE.map((row) => (
            <li
              key={row.id}
              className="grid gap-1 rounded-xl border border-border bg-surface px-4 py-3 sm:grid-cols-[11rem_7rem_1fr] sm:items-baseline sm:gap-3"
            >
              <span className="font-medium text-foreground">
                {t(IMPORT_SCOPE_ROW_KEYS[row.id].what)}
              </span>
              <span>
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${scopeChip[row.scope].className}`}
                >
                  {scopeChip[row.scope].label}
                </span>
              </span>
              <span className="text-sm leading-6 text-muted">
                {t(IMPORT_SCOPE_ROW_KEYS[row.id].detail)}
              </span>
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
              <FunnelTag source={guideSource(guide.slug)} />
              <SubmitButton
                pendingLabel={t("switching.competitor.gettingDemoReady")}
                className={buttonClass({
                  size: "cta",
                  className: "cursor-pointer disabled:opacity-70",
                })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref(guideSource(guide.slug))}
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
            {t("switching.competitor.step3")}
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
            {t("switching.competitor.bringFileTitle")}
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
            {t("switching.competitor.bringFileIntro")}
          </p>
          <ol className="mt-10 space-y-6">
            <li className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                1
              </span>
              <div className="pt-1">
                <h3 className="font-semibold leading-6">
                  {t("switching.competitor.openSettingsTitle")}
                </h3>
                <p className="mt-1.5 leading-7 text-muted">
                  {t("switching.competitor.openSettingsBody")}
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                2
              </span>
              <div className="pt-1">
                <h3 className="font-semibold leading-6">
                  {t("switching.competitor.checkPreviewTitle")}
                </h3>
                <p className="mt-1.5 leading-7 text-muted">
                  {t("switching.competitor.checkPreviewBody")}
                </p>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                3
              </span>
              <div className="pt-1">
                <h3 className="font-semibold leading-6">
                  {t("switching.competitor.importReadyTitle")}
                </h3>
                <p className="mt-1.5 leading-7 text-muted">
                  {t("switching.competitor.importReadyBody")}
                </p>
              </div>
            </li>
          </ol>

          {guide.importerNote && (
            <p className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-5 text-sm leading-6 text-muted">
              <span className="font-semibold text-foreground">
                {t("switching.competitor.forExportPrefix", { competitor: guide.competitor })}{" "}
              </span>
              {t(guide.importerNote)}
            </p>
          )}

          <Suspense fallback={null}>{importCta}</Suspense>
        </div>
      </section>

      {/* What the actual switch looks like — parallel-run, timing, re-import safety. */}
      <section className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
        <h2 className="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-4xl">
          {t(guide.cutover.heading)}
        </h2>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">{t(guide.cutover.intro)}</p>

        <ol className="mt-10 space-y-6">
          {guide.cutover.steps.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {index + 1}
              </span>
              <div className="pt-1">
                <h3 className="font-semibold leading-6">{t(step.title)}</h3>
                <p className="mt-1.5 leading-7 text-muted">{t(step.detail)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* The owner-authorized concierge switch offer (shared across /switching). */}
      <SwitchingConcierge locale={locale} />

      <section className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-16 sm:flex-row sm:items-center lg:py-20">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {guide.coexist
              ? t("switching.competitor.runTheDay", { competitor: guide.competitor })
              : t("switching.competitor.readyToMove", { competitor: guide.competitor })}
          </h2>
          <p className="mt-2 max-w-xl text-muted">{t("switching.competitor.walkDemoFirst")}</p>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-col gap-3 sm:flex-row">
            <form action={enterDemoAction} className="contents">
              <FunnelTag source={guideSource(guide.slug)} />
              <SubmitButton
                pendingLabel={t("switching.competitor.gettingDemoReady")}
                className={buttonClass({
                  size: "cta",
                  className: "cursor-pointer disabled:opacity-70",
                })}
              >
                {t("marketing.common.tryDemo")}
              </SubmitButton>
            </form>
            <Link
              href={trialHref(guideSource(guide.slug))}
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
            {t("switching.competitor.otherGuides")}
          </Link>
        </div>
      </section>

      {guide.sources.length > 0 && (
        <section className="border-t border-border">
          <div className="mx-auto max-w-4xl px-6 py-8">
            <h2 className="text-xs font-semibold tracking-widest text-muted uppercase">
              {t("switching.competitor.sources")}
            </h2>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm text-muted">
              {guide.sources.map((source) => (
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
      )}
    </main>
  );
}
