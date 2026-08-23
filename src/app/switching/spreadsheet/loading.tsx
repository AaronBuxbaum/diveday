import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * The `/switching/spreadsheet` segment's `<Suspense>` boundary, and what a
 * client navigation into it paints (ADR 20260804-instant-navigation). Same
 * arrangement, and the same reason, as `src/app/product/loading.tsx`: the
 * page's `requestLocale()` read sits above everything it renders, so the chrome
 * is here too — `MarketingNavFallback` and `MarketingFooterFallback`, the
 * signed-out default-locale header and footer that almost every visitor to this
 * page gets anyway.
 *
 * The body is bars, and that is the point of this file rather than an economy:
 * the page it replaces used to paint a **whole second copy of itself in
 * English** as its fallback, and a reader who reached the CSV template button
 * or the importer door before the localized body resolved had the interaction
 * thrown away (FU-20260812-marketing-suspense-swap-discards-interaction). A
 * skeleton has nothing to tap, so there is nothing to lose. Anything
 * interactive added to this file reopens that bug.
 *
 * Shaped like the guide hero above the fold — back link, eyebrow, headline,
 * lede, the demo/trial pair, and the four-fact strip under its hairline — then
 * the "you are here" band, so the streamed page lands where the bars stood.
 */
export default function SpreadsheetSwitchLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <main className="flex-1 animate-pulse">
        {/* GuideHero. */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
            <div className="h-4 w-40 rounded bg-surface-sunken" />
            <div className="mt-6 h-4 w-52 rounded bg-surface-sunken" />
            <div className="mt-4 h-11 w-full max-w-xl rounded bg-surface-sunken sm:h-12" />
            <div className="mt-3 h-11 w-2/3 max-w-md rounded bg-surface-sunken sm:h-12" />
            <div className="mt-6 h-5 w-full max-w-2xl rounded bg-surface-sunken" />
            <div className="mt-2 h-5 w-3/4 max-w-xl rounded bg-surface-sunken" />
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <div className="h-11 w-full rounded-lg bg-surface-sunken sm:w-44" />
              <div className="h-11 w-full rounded-lg bg-surface-sunken sm:w-44" />
            </div>
            <div className="mt-3 h-4 w-72 max-w-full rounded bg-surface-sunken" />

            {/* The four guide facts, at the height the real strip holds. */}
            <div className="mt-10 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-border pt-6 lg:grid-cols-4">
              {[0, 1, 2, 3].map((fact) => (
                <div key={fact}>
                  <div className="h-3 w-24 rounded bg-surface-sunken" />
                  <div className="mt-2 h-4 w-32 max-w-full rounded bg-surface-sunken" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* "You are here": eyebrow, two paragraphs, then the wedge list. */}
        <section className="mx-auto max-w-4xl px-6 py-14 lg:py-20">
          <div className="h-4 w-36 rounded bg-surface-sunken" />
          <div className="mt-5 space-y-3 max-w-2xl">
            <div className="h-5 w-full rounded bg-surface-sunken" />
            <div className="h-5 w-5/6 rounded bg-surface-sunken" />
            <div className="h-5 w-full rounded bg-surface-sunken" />
            <div className="h-5 w-2/3 rounded bg-surface-sunken" />
          </div>
          <div className="mt-8 grid gap-x-10 sm:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="border-t border-border py-5">
                <div className="h-4 w-40 max-w-full rounded bg-surface-sunken" />
                <div className="mt-3 h-4 w-full max-w-sm rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
        </section>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
