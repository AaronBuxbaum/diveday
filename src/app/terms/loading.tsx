import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { LegalDocumentSkeleton, type LegalSkeletonBlock } from "@/components/LegalDocument";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * The `/terms` segment's <Suspense> boundary, and what a client navigation
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
 * The bars stand in the document's own boxes (`LegalDocumentSkeleton`), so the
 * streamed page lands where they stood. What is this page's own is how far its
 * words wrap: the en-US copy's lines at 390 (`base`) and 1280 (`sm`; the column
 * stops widening at 768), the widths the visual suite captures. It used to be
 * `/privacy`'s skeleton line for line, with two title bars for a title that is
 * one line at every width, three intro bars for an intro of four lines on a
 * phone and two on a desk, and three bars a section, so the page jumped 53px
 * on a desk and reshaped the phone's first screen (K-411).
 */
export default function TermsLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <LegalDocumentSkeleton
        eyebrowWidth="w-32"
        titleWidth="w-11/12 sm:w-1/2"
        titleLines={1}
        introLines={{ base: 4, sm: 2 }}
        sections={TERMS_SECTIONS}
      />
      <MarketingFooterFallback />
    </div>
  );
}

/** Each section's lines, in the page's order. */
const TERMS_SECTIONS: ReadonlyArray<ReadonlyArray<LegalSkeletonBlock>> = [
  // What DiveDay is: the rest of the phone's first screen.
  [{ base: 9, sm: 5 }],
  // The shop's side: three terms.
  [
    {
      terms: [
        { base: 3, sm: 2 },
        { base: 5, sm: 3 },
        { base: 3, sm: 2 },
      ],
    },
  ],
  // Money
  [{ base: 7, sm: 4 }],
  // Whose data it is
  [{ base: 8, sm: 4 }],
  // What we do not promise
  [{ base: 6, sm: 3 }],
  // Using it for what it is for
  [{ base: 6, sm: 3 }],
  // Ending it
  [{ base: 6, sm: 3 }],
  // Changes to these terms
  [{ base: 4, sm: 2 }],
  // Asking us something
  [1],
];
