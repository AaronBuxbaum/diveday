import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { SWITCH_EMAIL, SwitchingConcierge } from "@/components/SwitchingConcierge";
import { SwitchingImportCta } from "@/components/SwitchingImportCta";
import { groupLabelClass } from "@/components/ui/ledger";
import { BANNER_TITLE_CLASS, SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { guideSource } from "@/lib/funnel";
import { sharedLinkCard } from "@/lib/marketing";
import {
  getMigrationGuide,
  MIGRATION_GUIDE_SLUGS,
  type MigrationGuide,
} from "@/lib/migration-guides";
import {
  ClosingCta,
  DividedList,
  GuideContext,
  GuideHero,
  ImportPhase,
  MidCta,
  MovePath,
  MovePhase,
  PhaseNotes,
  ScopePhase,
  SourcesFootnote,
  StepList,
} from "../_components/guide";

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
  const importSource = guideSource(guide.slug, "mid");
  return (
    <GuideBody
      locale={locale}
      guide={guide}
      importCta={
        <SwitchingImportCta
          label={t("switching.common.openImportCta")}
          trialLabel={t("marketing.common.startTrial")}
          source={importSource}
        />
      }
    />
  );
}

/**
 * Cached per (negotiated locale, guide) — `guide` is a plain, serializable
 * data object (`src/lib/migration-guides.ts`), safe as a `"use cache"`
 * argument. `importCta` carries {@link SwitchingImportCta} (session-scoped —
 * reads `auth()`) as a pass-through slot per Next's interleaving rules. Its
 * funnel source is bound before it crosses this cache boundary, so this body
 * only renders the slot unchanged and its per-visitor content never enters the
 * cache entry.
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
  const source = guideSource(guide.slug);

  return (
    <main className="flex-1">
      <GuideHero
        locale={locale}
        source={source}
        eyebrow={t(guide.heroEyebrow)}
        title={t(guide.heroTitle)}
        lede={t(guide.heroLede)}
      />

      {/* Honest framing of the incumbent. */}
      <GuideContext locale={locale} paragraphs={guide.context.map((key) => t(key))} />

      {/* Coexist framing: for a booking channel a shop keeps (FareHarbor,
          Rezdy), the "keep the storefront, we run the water" division of
          labor, plus the honest alternative of leaving. Absent for the
          leave-it guides. */}
      {guide.coexist && (
        <section className="border-y border-border">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("switching.competitor.keepOrLeaveEyebrow")}
            </p>
            <h2 className={`mt-3 ${BANNER_TITLE_CLASS} sm:text-4xl`}>{t(guide.coexist.heading)}</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">{t(guide.coexist.intro)}</p>

            {/* Shared messages — two of them interpolate the competitor's name. */}
            <DividedList
              items={guide.coexist.runsInDiveDay.map((item) => ({
                title: t(item.title),
                detail: t(item.detail, { competitor: guide.competitor }),
              }))}
            />

            <p className="mt-8 max-w-2xl leading-7 text-muted">{t(guide.coexist.bridgeNote)}</p>

            <div className="mt-8 rounded-panel border border-primary/30 bg-primary/5 p-6">
              <h3 className={`${SECTION_TITLE_CLASS} tracking-tight`}>
                {t(guide.coexist.replace.heading)}
              </h3>
              <p className="mt-2 leading-7 text-muted">{t(guide.coexist.replace.body)}</p>
              {/* The one forward link to /pricing on a switching guide, and it
                  belongs here rather than in the closing band. This page has
                  just told a shop owner what the incumbent's per-booking fee
                  costs them; "and yours costs what?" is the next thought, and
                  until now the only answer was the nav tab several thousand
                  pixels up (these guides run 6,000-8,000px). The closing band
                  already carries three controls, so a fourth there would break
                  principles.md #8's one-primary rule.

                  A destination, never a claim: no figure, no "flat price", no
                  savings arithmetic. The price renders only from
                  src/lib/marketing.ts (marketing.md's claims policy), and
                  /pricing already links back here for the fee citation -- this
                  is what closes that loop in the other direction. */}
              <Link
                href="/pricing"
                className="mt-4 inline-block font-medium text-primary underline underline-offset-4"
              >
                {t("switching.common.seePricing")}
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* The website ledger (FareHarbor today): what the shop pasted from the
          incumbent beside the DiveDay embed that replaces it, the hosted-site
          comparison, and the built-to-order website. It sits between the
          coexist argument and the mid-page door so the reader who has just
          been told "keep it, or leave it" sees the leave path is not a
          rebuild of their site — and the demo door follows immediately, first
          of the two, as everywhere on these pages. No third door of its own:
          the offer's one action is the address to write to. */}
      {guide.website && (
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-20">
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              {t("switching.competitor.websiteEyebrow")}
            </p>
            <h2 className={`mt-3 ${BANNER_TITLE_CLASS} sm:text-4xl`}>{t(guide.website.heading)}</h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">{t(guide.website.intro)}</p>

            {/* The two column labels render at every width — on a phone the
                rows are two narrow columns rather than a stack, so a reader
                who never sees a desktop still knows which side is whose. */}
            <div className="mt-8 grid grid-cols-[7.5rem_1fr] gap-3 sm:grid-cols-[15rem_1fr] sm:gap-4">
              <span className={groupLabelClass()}>
                {t("switching.competitor.websiteTheirs", { competitor: guide.competitor })}
              </span>
              <span className={groupLabelClass()}>{t("switching.competitor.websiteOurs")}</span>
            </div>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {guide.website.ledger.map((row) => (
                <li
                  key={row.theirs}
                  className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3 py-3 sm:grid-cols-[15rem_1fr] sm:gap-4"
                >
                  <span className="font-medium text-foreground">{t(row.theirs)}</span>
                  <span className="text-sm leading-6 text-muted">{t(row.ours)}</span>
                </li>
              ))}
            </ul>

            <p className="mt-8 max-w-2xl leading-7 text-muted">
              {t(guide.website.sitesNote, { sitesPrice: guide.website.sitesPrice })}
            </p>

            <div className="mt-8 rounded-panel border border-primary/30 bg-primary/5 p-6">
              <h3 className={`${SECTION_TITLE_CLASS} tracking-tight`}>
                {t(guide.website.offer.heading)}
              </h3>
              <p className="mt-2 leading-7 text-muted">{t(guide.website.offer.body)}</p>
              {/* The concierge's own door, reused word for word: one address
                  for the switch and the website, said the same way twice. */}
              <a
                href={`mailto:${SWITCH_EMAIL}`}
                className="mt-4 inline-block font-medium text-primary underline underline-offset-4"
              >
                {t("switching.concierge.emailCta", { email: SWITCH_EMAIL })}
              </a>
            </div>
          </div>
        </section>
      )}

      <MidCta locale={locale} source={guideSource(guide.slug, "mid")} />

      {/* The whole mechanical path, as one rail: export (files the shop makes
          itself) → the importer's own scope table, verbatim → the importer →
          the cutover. */}
      <MovePath locale={locale}>
        <MovePhase number={1} title={t(guide.exportHeading)} intro={t(guide.exportIntro)}>
          <StepList
            steps={guide.exportSteps.map((step) => ({
              title: t(step.title),
              detail: t(step.detail),
            }))}
          />
          {guide.exportNotes.length > 0 && (
            <PhaseNotes notes={guide.exportNotes.map((note) => t(note))} />
          )}
        </MovePhase>
        <ScopePhase locale={locale} number={2} />
        <ImportPhase
          locale={locale}
          number={3}
          importerNote={
            guide.importerNote && (
              <>
                <span className="font-semibold text-foreground">
                  {t("switching.competitor.forExportPrefix", { competitor: guide.competitor })}{" "}
                </span>
                {t(guide.importerNote)}
              </>
            )
          }
        >
          <Suspense fallback={null}>{importCta}</Suspense>
        </ImportPhase>
        <MovePhase number={4} title={t(guide.cutover.heading)} intro={t(guide.cutover.intro)}>
          <StepList
            steps={guide.cutover.steps.map((step) => ({
              title: t(step.title),
              detail: t(step.detail),
            }))}
          />
        </MovePhase>
      </MovePath>

      {/* The owner-authorized concierge switch offer (shared across /switching). */}
      <SwitchingConcierge locale={locale} />

      <ClosingCta
        locale={locale}
        source={guideSource(guide.slug, "close")}
        title={
          guide.coexist
            ? t("switching.competitor.runTheDay", { competitor: guide.competitor })
            : t("switching.competitor.readyToMove", { competitor: guide.competitor })
        }
        body={t("switching.competitor.walkDemoFirst")}
        backLabel={t("switching.competitor.otherGuides")}
      />

      {guide.sources.length > 0 && <SourcesFootnote locale={locale} sources={guide.sources} />}
    </main>
  );
}
