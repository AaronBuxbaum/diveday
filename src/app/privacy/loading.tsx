import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { LegalDocumentSkeleton, type LegalSkeletonBlock } from "@/components/LegalDocument";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * The `/privacy` segment's <Suspense> boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation). Same arrangement as
 * `src/app/about/loading.tsx`: the page's `requestLocale()` read sits above
 * everything it renders, so the real signed-out chrome is here rather than a
 * grey bar, and the body is bars.
 *
 * Bars specifically, and nothing interactive: a fallback holds *shape*, never
 * interaction. A fallback that rendered the real document in a default locale
 * would throw away anything the reader did to it when the localized body landed
 * (ADR 20260804-instant-navigation's 2026-08-14 amendment).
 *
 * The bars stand in the document's own boxes (`LegalDocumentSkeleton`, the
 * one skeleton `/terms` wears too), so the streamed page lands where they
 * stood (K-407). What is this page's own is how far its words wrap: the en-US
 * copy's lines at 390 (`base`) and 1280 (`sm`; the column stops widening at
 * 768), the widths the visual suite captures. A title that takes two lines on
 * a phone, an intro of eight lines and four, then "Two different
 * relationships" and "What is stored" term by term, which reaches past the
 * fold at both widths, so the footer never shows early. A rewrite that
 * changes how the title, the intro or those terms wrap changes these numbers.
 */
export default function PrivacyLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <LegalDocumentSkeleton
        eyebrowWidth="w-60"
        titleWidth="w-5/6 sm:w-11/12"
        titleLines={{ base: 2, sm: 1 }}
        introLines={{ base: 8, sm: 4 }}
        sections={PRIVACY_SECTIONS}
      />
      <MarketingFooterFallback />
    </div>
  );
}

/** Each section's lines, in the page's order, down past the fold. */
const PRIVACY_SECTIONS: ReadonlyArray<ReadonlyArray<LegalSkeletonBlock>> = [
  // Two different relationships: the shop, then the shop's divers.
  [
    {
      terms: [
        { base: 3, sm: 2 },
        { base: 8, sm: 4 },
      ],
    },
  ],
  // What is stored: six terms.
  [
    {
      terms: [
        { base: 3, sm: 2 },
        { base: 4, sm: 2 },
        { base: 7, sm: 4 },
        { base: 6, sm: 3 },
        { base: 4, sm: 2 },
        { base: 14, sm: 7 },
      ],
    },
  ],
];
