import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * The `/about` segment's `<Suspense>` boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation). Same arrangement, and the
 * same reason, as `src/app/product/loading.tsx`: the page's `requestLocale()`
 * read sits above everything it renders, so the chrome is here too, and it is
 * the real signed-out, default-locale header and footer rather than a grey bar.
 *
 * The body is bars, which is the point of this file and not an economy: the
 * page it replaces used to paint a **whole second copy of itself in English**
 * as its fallback, and a visitor who acted on it before the localized body
 * landed had the act thrown away
 * (FU-20260812-marketing-suspense-swap-discards-interaction). A skeleton has
 * nothing to tap, so there is nothing to lose. Anything interactive added to
 * this file reopens that bug.
 *
 * Shaped like the body above the fold (the hero's two paragraphs beside the
 * captain's phone, then the band on who is behind DiveDay) so the streamed
 * page lands where the bars stood. The four rules and their demo/trial pair
 * sat second until the 2026-10-06 rewrite and are below the fold now.
 */
export default function AboutLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <main className="flex-1 animate-pulse">
        {/* Hero: the claim on the left, the artifact it sends you to check on
            the right. */}
        <section className="border-b border-border">
          <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1fr_0.8fr] lg:items-center lg:py-24">
            <div className="max-w-2xl">
              <div className="h-4 w-32 rounded bg-surface-sunken" />
              <div className="mt-5 h-12 w-full rounded bg-surface-sunken sm:h-14 lg:h-16" />
              <div className="mt-3 h-12 w-3/4 rounded bg-surface-sunken sm:h-14 lg:h-16" />
              <div className="mt-6 h-6 w-full max-w-xl rounded bg-surface-sunken" />
              <div className="mt-2 h-6 w-full max-w-xl rounded bg-surface-sunken" />
              <div className="mt-2 h-6 w-2/3 max-w-lg rounded bg-surface-sunken" />
              <div className="mt-4 h-6 w-full max-w-xl rounded bg-surface-sunken" />
              <div className="mt-2 h-6 w-full max-w-xl rounded bg-surface-sunken" />
              <div className="mt-2 h-6 w-1/2 max-w-lg rounded bg-surface-sunken" />
            </div>
            {/* The phone at the height `CaptainPhoneFrame` renders it, which
                is its mockup's, not a ratio: 468px in the 320px `max-w-xs`
                column below `lg`, where the roll call wraps one more line,
                and 450px in the 384px one from `lg`, where the phone sets the
                hero's height. It was a guessed 480px, and the page under it
                rose 30px on arrival (K-394). */}
            <div className="mx-auto w-full max-w-xs lg:max-w-sm">
              <div className="h-[468px] rounded-[2.5rem] border border-border bg-surface lg:h-[450px]" />
            </div>
          </div>
        </section>

        {/* The band that follows the hero since the 2026-10-06 rewrite: who
            is behind DiveDay, heading beside three paragraphs on the surface
            fill, with the same grid and gaps the page uses so the streamed
            band lands where the bars stood. */}
        <section className="border-b border-border bg-surface">
          <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1fr] lg:items-start lg:gap-10">
              <div>
                <div className="h-4 w-28 rounded bg-surface-sunken" />
                <div className="mt-4 h-9 w-full max-w-sm rounded bg-surface-sunken sm:h-10" />
              </div>
              <div className="max-w-2xl space-y-5">
                {[0, 1, 2].map((paragraph) => (
                  <div key={paragraph}>
                    <div className="h-6 w-full rounded bg-surface-sunken" />
                    <div className="mt-2 h-6 w-full rounded bg-surface-sunken" />
                    <div className="mt-2 h-6 w-2/3 rounded bg-surface-sunken" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
