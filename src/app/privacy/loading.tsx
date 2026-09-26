import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { LegalDocumentFallback } from "@/components/LegalDocument";
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
 * The document's first screen, line for line, so the streamed page lands where
 * the bars stood (K-407). The counts are how far the English wraps in the
 * page's 720px column (from `sm`) and at a 390px phone (below it): a one-line
 * title that takes two on a phone, a four-line intro that takes eight, then
 * "Two different relationships" and "What is stored", each term at its own
 * count. The two sections reach past the fold at every width, so the footer
 * never shows early. A rewrite that changes how the intro or those terms wrap
 * changes these numbers.
 */
export default function PrivacyLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <LegalDocumentFallback
        titleLines={{ base: 2, sm: 1 }}
        introLines={{ base: 8, sm: 4 }}
        sections={[
          [
            {
              terms: [
                { base: 3, sm: 2 },
                { base: 7, sm: 4 },
              ],
            },
          ],
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
        ]}
      />
      <MarketingFooterFallback />
    </div>
  );
}
