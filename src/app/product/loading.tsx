import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { SkeletonLineBars } from "@/components/ShopPageHeader";
import { groupLabelClass } from "@/components/ui/ledger";
import {
  DISPLAY_TITLE_CLASS,
  MARKETING_EYEBROW_CLASS,
  SECTION_TITLE_CLASS,
} from "@/components/ui/typography";
import { FEATURE_PHASES, featurePagesIn } from "@/lib/feature-pages";

/**
 * The `/product` segment's `<Suspense>` boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation).
 *
 * It stands in for the *whole* page, not just its main column, because the
 * page's own request-scoped read — `requestLocale()` — sits above everything
 * it renders. So the chrome is here too, and it is the real thing rather than
 * a grey bar: `MarketingNavFallback` and `MarketingFooterFallback` are the
 * signed-out, default-locale header and footer, which is what the
 * overwhelming majority of visitors to this page get anyway.
 *
 * The body is bars. That is the point of this file and not an economy: the
 * page it replaces used to paint a **whole second copy of itself in English**
 * as its fallback, and a visitor who tapped the chapter strip it had then had
 * the tap thrown away when the localized body swapped in
 * (FU-20260812-marketing-suspense-swap-discards-interaction). A skeleton has
 * nothing to tap, so there is nothing to lose. Anything interactive added to
 * this file reopens that bug.
 *
 * Shaped like the body above the fold — the hero, then the feature directory
 * — so the streamed page lands where the bars stood instead of shifting under
 * a reader who has already started scrolling. The hero's bars are its line
 * boxes, `h-lh` in the type of the text they stand for, as many as the English
 * wraps to at 1280 and at a 390px phone (`SkeletonLineBars`, the phone's extra
 * lines `sm:hidden`); a rewrite that changes how the title or the lede wraps
 * changes these counts (K-409). The directory draws one row per feature page
 * under each phase, read off the same registry the page reads, so a page added
 * there is a row here too: a name line and two summary lines, the summary most
 * pages wrap to in a third of 1280.
 */
export default function ProductLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <main className="flex-1 animate-pulse">
        {/* Hero: eyebrow, the title, the lede, the CTA pair, the demo note and
            the price line, at the page's own margins. */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-20 lg:py-28">
            <SkeletonLineBars
              lines={1}
              height={`h-lh ${MARKETING_EYEBROW_CLASS}`}
              width="mx-auto w-40"
            />
            <div className="mt-5">
              <SkeletonLineBars
                lines={{ base: 3, sm: 2 }}
                height={`h-lh ${DISPLAY_TITLE_CLASS} sm:text-6xl`}
                width="mx-auto max-w-2xl"
              />
            </div>
            <div className="mt-6">
              <SkeletonLineBars
                lines={{ base: 4, sm: 2 }}
                height="h-lh text-lg leading-8"
                width="mx-auto max-w-xl"
              />
            </div>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
            </div>
            <div className="mt-3">
              <SkeletonLineBars
                lines={{ base: 2, sm: 1 }}
                height="h-lh text-sm"
                width="mx-auto w-72 max-w-full"
              />
            </div>
            <div className="mt-2">
              <SkeletonLineBars
                lines={{ base: 2, sm: 1 }}
                height="h-lh text-sm"
                width="mx-auto w-80 max-w-full"
              />
            </div>
          </div>
        </section>

        {/* The directory: each phase's label over one row per page, a name
            and its summary between hairlines, three columns from lg. */}
        <section className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <div className="grid gap-x-10 gap-y-12 lg:grid-cols-3">
            {FEATURE_PHASES.map((phase) => (
              <div key={phase}>
                <SkeletonLineBars
                  lines={1}
                  height={`h-lh ${groupLabelClass("primary")}`}
                  width="w-36"
                />
                <ul className="mt-4 border-t border-border">
                  {featurePagesIn(phase).map((page) => (
                    <li key={page.slug} className="border-b border-border py-4">
                      <SkeletonLineBars
                        lines={1}
                        height={`h-lh ${SECTION_TITLE_CLASS}`}
                        width="w-48 max-w-full"
                      />
                      <div className="mt-1">
                        <SkeletonLineBars
                          lines={2}
                          height="h-lh text-sm leading-6"
                          width="w-full"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
