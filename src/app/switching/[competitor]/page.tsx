import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Eyebrow } from "@/app/_components/Eyebrow";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { SwitchingConcierge } from "@/components/SwitchingConcierge";
import { SwitchingImportCta } from "@/components/SwitchingImportCta";
import { groupLabelClass } from "@/components/ui/group-label";
import { BANNER_TITLE_CLASS, ITEM_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { guideSource, setUpHref } from "@/lib/funnel";
import { sharedLinkCard } from "@/lib/marketing";
import {
  getMigrationGuide,
  guideForPlan,
  MIGRATION_GUIDE_SLUGS,
  type MigrationGuide,
  WEBSITE_LEDGER_ID,
} from "@/lib/migration-guides";
import { requestPricingArm } from "@/lib/pricing-arm-request";
import {
  ClosingCta,
  DividedList,
  GUIDE_BAND_CLASS,
  GUIDE_BAND_LEDE_CLASS,
  GuideBodySkeleton,
  GuideContents,
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
import { GUIDE_SKELETON_LINES } from "../_components/guide-skeleton-lines";
import { CALLOUT_LINK_CLASS, ReplaceCallout } from "../_components/ReplaceCallout";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
export const instant = true;

// Only the registered guides are valid routes. `dynamicParams` is not
// compatible with Cache Components (nextConfig.cacheComponents), so an
// unregistered slug cannot be refused from this config: the status is decided
// in `src/proxy.ts`, which judges the segment against this same
// `MIGRATION_GUIDE_SLUGS` before anything streams (issue #1734). What this
// still buys is the prerendered shell for each registered guide.
export function generateStaticParams() {
  return MIGRATION_GUIDE_SLUGS.map((competitor) => ({ competitor }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const { competitor } = await params;
  const found = getMigrationGuide(competitor);
  if (!found) return { title: "Switching to DiveDay" };
  // Per pricing arm; while the test is off this reads nothing from the request.
  const guide = guideForPlan(found, await requestPricingArm());
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
    // `summary_large_image`: the shared link card (`sharedLinkCard`, served from
    // `/link-card`) for every registered guide — docs/product/marketing.md,
    // Twitter-card policy. Built from the
    // same two strings as the OG block so a guide can never unfurl one story on
    // one network and another elsewhere.
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function MigrationGuidePage({
  params,
}: {
  params: Promise<{ competitor: string }>;
}) {
  // **`params` is not read here.** Under Partial Prefetching (`next.config.ts`)
  // the App Shell is one artifact shared by every guide, so anything that
  // names a slug has to sit behind a `<Suspense>` boundary. A page that
  // awaited `params` at its top answered 200 until its cached shell
  // revalidated, then 500 (`NEXT_STATIC_GEN_BAILOUT`): the background
  // re-prerender had no boundary to postpone at (issue #2546). The shell is
  // the frame every guide shares, as bars; `GuideRoute` resolves the slug.
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<GuideShell />}>
        <GuideRoute params={params} />
      </Suspense>
    </div>
  );
}

/** The frame every guide shares, painted until the slug is known: no `guide` is in scope, so the bars are the longest registered guide's. */
function GuideShell() {
  return (
    <>
      <MarketingNavFallback />
      <GuideBodySkeleton lines={GUIDE_SKELETON_LINES.eve} />
      <MarketingFooterFallback />
    </>
  );
}

async function GuideRoute({ params }: { params: Promise<{ competitor: string }> }) {
  // Resolved and checked here, and it is the *second* layer: under
  // `cacheComponents` a slug outside `generateStaticParams` gets an optimistic
  // 200 App Shell on the wire before this body runs, so no `notFound()`
  // anywhere in the page can move the status line. `src/proxy.ts` decides it
  // against this same list before anything streams (issue #1734, ADR
  // 20260912-the-public-namespace-refuses-at-the-edge), and
  // `e2e/marketing.spec.ts` asserts the status. This check stays because it is
  // what renders the refusal; the lookup is a synchronous in-memory match
  // against `MIGRATION_GUIDE_SLUGS`.
  const { competitor } = await params;
  const guide = getMigrationGuide(competitor);
  if (!guide) notFound();
  return (
    <>
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      {/* No `loading.tsx` stands above this segment, so this boundary is what
          paints while the localized body streams: the guide's hero and "you
          are here" band as bars, a bar per line this guide's words wrap to.
          It was an empty `<main>`, 0px against a 6,000–13,000px guide, and the
          footer painted at the top (K-342). */}
      <Suspense fallback={<GuideBodySkeleton lines={GUIDE_SKELETON_LINES[guide.slug]} />}>
        <LocalizedGuideBody guide={guide} />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </>
  );
}

async function LocalizedGuideBody({ guide: registered }: { guide: MigrationGuide }) {
  const [locale, arm] = await Promise.all([requestLocale(), requestPricingArm()]);
  // The guide as this reader's pricing arm reads it, so the cache keys on it.
  const guide = guideForPlan(registered, arm);
  const t = diverTranslator(locale);
  const label = t("switching.common.openImportCta");
  const importCta = <SwitchingImportCta label={label} from={guide.slug} />;
  return <GuideBody locale={locale} guide={guide} importCta={importCta} />;
}

/**
 * The website ledger's two columns, one class for the head row and every
 * ledger row so the heads stay over their columns. `8rem` on a phone: at
 * `7.5rem` (120px) the tracked small-caps head "IN FAREHARBOR", about 122px,
 * broke after "IN" (K-579); es-ES "EN FAREHARBOR" is the same length.
 */
const WEBSITE_LEDGER_COLUMNS = "grid-cols-[8rem_1fr] gap-3 sm:grid-cols-[15rem_1fr] sm:gap-4";

/**
 * Cached per (negotiated locale, guide) — `guide` is a plain, serializable
 * data object (`src/lib/migration-guides.ts`), safe as a `"use cache"`
 * argument. `importCta` carries {@link SwitchingImportCta} (session-scoped —
 * reads `auth()`) as a pass-through slot per Next's interleaving rules. This body
 * only renders the slot unchanged, so its per-visitor content never enters the
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
      <GuideContents locale={locale} />

      <GuideContext locale={locale} paragraphs={guide.context.map((key) => t(key))} />

      {/* Coexist framing: for a booking channel a shop keeps (FareHarbor,
          Rezdy), the "keep the storefront, we run the water" division of
          labor, plus the honest alternative of leaving. Absent for the
          leave-it guides. Ruled below only: `GuideContext` above it draws the
          rule on top (K-204). */}
      {guide.coexist && (
        <section className="border-b border-border">
          <div className={GUIDE_BAND_CLASS}>
            <Eyebrow>{t("switching.competitor.keepOrLeaveEyebrow")}</Eyebrow>
            <h2 className={`mt-3 ${BANNER_TITLE_CLASS} sm:text-4xl`}>{t(guide.coexist.heading)}</h2>
            <p className={GUIDE_BAND_LEDE_CLASS}>{t(guide.coexist.intro)}</p>

            {/* Shared messages — two of them interpolate the competitor's name. */}
            <DividedList
              items={guide.coexist.runsInDiveDay.map((item) => ({
                title: t(item.title),
                detail: t(item.detail, { competitor: guide.competitor }),
              }))}
            />

            <p className="mt-8 max-w-2xl leading-7 text-muted">{t(guide.coexist.bridgeNote)}</p>

            {guide.coexist.replace && (
              <ReplaceCallout
                heading={t(guide.coexist.replace.heading)}
                body={t(guide.coexist.replace.body)}
                pricingLabel={t("switching.common.seePricing")}
              />
            )}
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
        <section id={WEBSITE_LEDGER_ID} className="scroll-mt-48 border-b border-border">
          <div className={GUIDE_BAND_CLASS}>
            <Eyebrow>{t("switching.competitor.websiteEyebrow")}</Eyebrow>
            <h2 className={`mt-3 ${BANNER_TITLE_CLASS} sm:text-4xl`}>{t(guide.website.heading)}</h2>
            <p className={GUIDE_BAND_LEDE_CLASS}>{t(guide.website.intro)}</p>

            {/* The two column labels render at every width — on a phone the
                rows are two narrow columns rather than a stack, so a reader
                who never sees a desktop still knows which side is whose. */}
            <div className={`mt-8 grid ${WEBSITE_LEDGER_COLUMNS}`}>
              <span className={groupLabelClass()}>
                {t("switching.competitor.websiteTheirs", { competitor: guide.competitor })}
              </span>
              <span className={groupLabelClass()}>{t("switching.competitor.websiteOurs")}</span>
            </div>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {guide.website.ledger.map((row) => (
                <li
                  key={row.theirs}
                  className={`grid ${WEBSITE_LEDGER_COLUMNS} items-baseline py-3`}
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
              <h3 className={`${ITEM_TITLE_CLASS} tracking-tight`}>
                {t(guide.website.offer.heading)}
              </h3>
              <p className="mt-2 leading-7 text-muted">{t(guide.website.offer.body)}</p>
              {/* The concierge's own door, reused word for word: one form
                  for the switch and the website, said the same way twice. */}
              <p className="mt-4 flex h-6 items-center">
                <Link
                  href={setUpHref(guideSource(guide.slug, "concierge"))}
                  className={CALLOUT_LINK_CLASS}
                >
                  {t("marketing.common.getSetUp")}
                </Link>
              </p>
            </div>
          </div>
        </section>
      )}

      <MidCta locale={locale} source={guideSource(guide.slug, "mid")} />

      {/* The whole mechanical path, as one rail: export (files the shop makes
          itself) → the importer's own scope table, verbatim → the importer →
          the cutover. */}
      <MovePath locale={locale}>
        <MovePhase
          id="export"
          number={1}
          title={t(guide.exportHeading)}
          intro={t(guide.exportIntro)}
        >
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
        <MovePhase
          id="cutover"
          number={4}
          title={t(guide.cutover.heading)}
          intro={t(guide.cutover.intro)}
        >
          <StepList
            steps={guide.cutover.steps.map((step) => ({
              title: t(step.title),
              detail: t(step.detail),
            }))}
          />
        </MovePhase>
      </MovePath>

      {/* The owner-authorized concierge switch offer (shared across /switching). */}
      <SwitchingConcierge locale={locale} source={guideSource(guide.slug, "concierge")} />

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
