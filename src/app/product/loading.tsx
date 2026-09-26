import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { SkeletonLineBars } from "@/components/ShopPageHeader";
import { DISPLAY_TITLE_CLASS, MARKETING_EYEBROW_CLASS } from "@/components/ui/typography";

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
 * as its fallback, and a visitor who tapped the anchor strip in that copy had
 * the tap thrown away when the localized body swapped in
 * (FU-20260812-marketing-suspense-swap-discards-interaction). A skeleton has
 * nothing to tap, so there is nothing to lose. Anything interactive added to
 * this file reopens that bug.
 *
 * Shaped like the body above the fold — hero, then the anchor strip's row,
 * then the first chapter's two columns — so the streamed page lands where the
 * bars stood instead of shifting under a reader who has already started
 * scrolling. The hero's bars are its line boxes, `h-lh` in the type of the
 * text they stand for, as many as the English wraps to at 1280 and at a 390px
 * phone (`SkeletonLineBars`, the phone's extra lines `sm:hidden`); the strip
 * is the real strip's one row of 52px tabs with no padding above or below
 * them (K-400), and never wraps. They
 * used to be 48px bars for 40px title lines, 20px bars for 32px lede lines, no
 * price line, and a strip that wrapped to three rows on a phone, so the strip
 * landed 36px lower at 1280 and 156px lower at 390 (K-409). A rewrite that
 * changes how the title, lede or notes wrap changes these counts.
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

        {/* The anchor strip: a label plus five chapters in one row that never
            wraps, each item the tabs' 52px with no padding around them, so
            the bar is the real one's 53px with its rule and the chapter below
            it does not jump when the real strip lands. */}
        <div className="border-b border-border">
          <div className="mx-auto flex max-w-6xl flex-nowrap items-center gap-x-4 overflow-hidden px-6 sm:gap-x-8">
            <div className="flex h-13 shrink-0 items-center">
              <div className="h-4 w-24 rounded bg-surface-sunken" />
            </div>
            {[0, 1, 2, 3, 4].map((entry) => (
              <div key={entry} className="flex h-13 shrink-0 items-center">
                <div className="h-4 w-28 rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
        </div>

        {/* Chapter 01: copy column beside the mockup it explains. */}
        <section className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <div className="h-4 w-32 rounded bg-surface-sunken" />
              <div className="mt-5 h-9 w-full max-w-md rounded bg-surface-sunken" />
              <div className="mt-3 h-9 w-2/3 max-w-sm rounded bg-surface-sunken" />
              <div className="mt-6 h-5 w-full rounded bg-surface-sunken" />
              <div className="mt-2 h-5 w-5/6 rounded bg-surface-sunken" />
              <div className="mt-7 space-y-3 border-l-2 border-border pl-5">
                {[0, 1, 2].map((point) => (
                  <div key={point} className="h-4 w-full max-w-sm rounded bg-surface-sunken" />
                ))}
              </div>
            </div>
            <div className="h-80 rounded-panel border border-border bg-surface shadow-bed" />
          </div>
        </section>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
