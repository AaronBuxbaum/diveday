import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNavFallback } from "@/components/MarketingNav";

/**
 * The `/pricing` segment's `<Suspense>` boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation). Same arrangement, and the
 * same reason, as `src/app/product/loading.tsx`: the page's `requestLocale()`
 * read sits above everything it renders, so the chrome is here too, and the
 * body is bars rather than a second English render of itself
 * (FU-20260812-marketing-suspense-swap-discards-interaction). Nothing in here
 * is interactive; anything interactive added reopens that bug.
 *
 * Shaped like the hero, which is the whole answer this page arrives with: the
 * plan line, the headline, the figure at display scale, the two doors, and the
 * hairline turn into what the number buys.
 */
export default function PricingLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <main className="flex-1 animate-pulse">
        <section className="border-b border-border">
          <div className="mx-auto max-w-3xl px-6 pt-20 pb-16 lg:pt-28 lg:pb-20">
            <div className="flex flex-col items-center">
              <div className="h-4 w-52 rounded bg-surface-sunken" />
              <div className="mt-6 h-11 w-full max-w-xl rounded bg-surface-sunken sm:h-12" />
              {/* The figure: `text-7xl`/`text-8xl` in the real hero, so the
                  bar standing in for it is deliberately the tallest thing on
                  this skeleton. */}
              <div className="mt-10 h-16 w-40 rounded bg-surface-sunken sm:h-20" />
              <div className="mt-5 h-4 w-32 rounded bg-surface-sunken" />
              <div className="mt-8 h-5 w-full max-w-xl rounded bg-surface-sunken" />
              <div className="mt-2 h-5 w-2/3 max-w-md rounded bg-surface-sunken" />
              <div className="mt-9 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
                <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-48" />
                <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-48" />
              </div>
              <div className="mt-6 h-4 w-72 max-w-full rounded bg-surface-sunken" />
            </div>

            {/* What the number buys: the hairline, then a two-column list. */}
            <div className="mt-14 border-t border-border pt-10">
              <div className="h-4 w-44 rounded bg-surface-sunken" />
              <div className="mt-6 grid gap-x-10 gap-y-4 sm:grid-cols-2">
                {[0, 1, 2, 3, 4, 5].map((item) => (
                  <div key={item} className="h-4 w-full max-w-xs rounded bg-surface-sunken" />
                ))}
              </div>
              <div className="mt-6 h-4 w-56 rounded bg-surface-sunken" />
            </div>
          </div>
        </section>

        {/* The fee anchor: heading, a line of argument, two quiet rows. */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
            <div className="h-9 w-full max-w-lg rounded bg-surface-sunken" />
            <div className="mt-6 h-4 w-full rounded bg-surface-sunken" />
            <div className="mt-2 h-4 w-5/6 rounded bg-surface-sunken" />
            <div className="mt-10 space-y-8">
              {[0, 1].map((row) => (
                <div key={row}>
                  <div className="h-4 w-32 rounded bg-surface-sunken" />
                  <div className="mt-3 h-4 w-full max-w-xl rounded bg-surface-sunken" />
                  <div className="mt-2 h-4 w-48 rounded bg-surface-sunken" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
