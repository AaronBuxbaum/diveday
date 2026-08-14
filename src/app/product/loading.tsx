import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNavFallback } from "@/components/MarketingNav";

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
 * scrolling.
 */
export default function ProductLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <main className="flex-1 animate-pulse">
        {/* Hero: eyebrow, two title lines, lede, the CTA pair, the demo note. */}
        <section className="border-b border-border">
          <div className="mx-auto flex max-w-4xl flex-col items-center px-6 py-20 lg:py-28">
            <div className="h-4 w-40 rounded bg-surface-sunken" />
            <div className="mt-6 h-12 w-full max-w-2xl rounded bg-surface-sunken sm:h-14" />
            <div className="mt-3 h-12 w-3/4 max-w-xl rounded bg-surface-sunken sm:h-14" />
            <div className="mt-7 h-5 w-full max-w-lg rounded bg-surface-sunken" />
            <div className="mt-2 h-5 w-2/3 max-w-md rounded bg-surface-sunken" />
            <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
            </div>
            <div className="mt-4 h-4 w-72 max-w-full rounded bg-surface-sunken" />
          </div>
        </section>

        {/* The anchor strip: a label plus five short entries, at its own height
            so the chapter below it does not jump when the real strip lands. */}
        <div className="border-b border-border">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-4">
            <div className="h-4 w-24 rounded bg-surface-sunken" />
            {[0, 1, 2, 3, 4].map((entry) => (
              <div key={entry} className="h-4 w-28 rounded bg-surface-sunken" />
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
            <div className="h-80 rounded-2xl border border-border bg-surface" />
          </div>
        </section>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
