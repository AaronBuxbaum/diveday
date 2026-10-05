import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import {
  FEATURE_PAGE_SLUGS,
  type FeaturePageSlug,
  featurePagePath,
  getFeaturePage,
} from "@/lib/feature-pages";
import { sharedLinkCard } from "@/lib/marketing";
import { FeaturePageBody } from "../_components/FeaturePageBody";
import { FeaturePageSkeleton } from "../_components/FeaturePageSkeleton";

// `instant = true`: navigating here paints immediately. The one request-scoped
// read, `requestLocale()`, sits behind the `<Suspense>` boundary below, and
// this segment's `loading.tsx` stands in for the page while `params` resolves.
// `next build` audits the claim (ADR 20260804-instant-navigation).
export const instant = true;

// Only the registered pages are routes. `dynamicParams` is not compatible with
// Cache Components, so an unregistered slug is refused in `src/proxy.ts`, which
// judges the segment against this same list before anything streams
// (`src/lib/public-route-shape.ts`); what this buys is the prerendered shell
// of each page.
export function generateStaticParams() {
  return FEATURE_PAGE_SLUGS.map((feature) => ({ feature }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ feature: string }>;
}): Promise<Metadata> {
  const { feature } = await params;
  const page = getFeaturePage(feature);
  if (!page) return { title: "Features — DiveDay" };
  // Fixed to the default locale, like every marketing page's metadata:
  // negotiating here would read request headers and cost the pages their
  // prerendered shells.
  const t = diverTranslator(DEFAULT_DIVER_LOCALE);
  const title = `${t(`marketing.featurePages.${page.key}.metaTitle`)} — DiveDay`;
  const description = t(`marketing.featurePages.${page.key}.metaDescription`);
  const url = featurePagePath(page.slug);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...sharedLinkCard, title, description, url },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function FeaturePage({ params }: { params: Promise<{ feature: string }> }) {
  // The second layer, as on the switching guides: the proxy has already
  // answered an unregistered slug with a real 404 before this streams, and
  // this check is what renders the refusal page if one ever gets through.
  const { feature } = await params;
  const page = getFeaturePage(feature);
  if (!page) notFound();
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<FeaturePageSkeleton />}>
        <LocalizedFeatureBody slug={page.slug} />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function LocalizedFeatureBody({ slug }: { slug: FeaturePageSlug }) {
  const locale = await requestLocale();
  return <FeaturePageBody slug={slug} locale={locale} />;
}
