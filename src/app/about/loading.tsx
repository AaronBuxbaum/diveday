import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { sectionCardClass } from "@/components/ui/card";

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
 * Shaped like the body above the fold — the hero beside the captain's phone,
 * then the four checkable operating rules — so the streamed page lands where
 * the bars stood.
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
              <div className="mt-2 h-6 w-2/3 max-w-lg rounded bg-surface-sunken" />
            </div>
            <div className="mx-auto w-full max-w-xs lg:max-w-sm">
              <div className="h-[30rem] rounded-[2.5rem] border border-border bg-surface" />
            </div>
          </div>
        </section>

        {/* The four operating rules, each in the card it lands in — the shell
            taken from `sectionCardClass()` with the same `padding` the page
            passes `SectionCard`, so the skeleton and what replaces it can no
            longer drift into a layout jump on every navigation here. */}
        <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          <div className="max-w-2xl">
            <div className="h-4 w-40 rounded bg-surface-sunken" />
            <div className="mt-4 h-9 w-full max-w-md rounded bg-surface-sunken sm:h-10" />
            <div className="mt-4 h-5 w-full rounded bg-surface-sunken" />
            <div className="mt-2 h-5 w-5/6 rounded bg-surface-sunken" />
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {[0, 1, 2, 3].map((rule) => (
              <div key={rule} className={sectionCardClass({ padding: "lg" })}>
                <div className="h-6 w-2/3 max-w-xs rounded bg-surface-sunken" />
                <div className="mt-4 h-4 w-full rounded bg-surface-sunken" />
                <div className="mt-2 h-4 w-5/6 rounded bg-surface-sunken" />
                <div className="mt-4 h-4 w-3/4 rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
        </section>
      </main>
      <MarketingFooterFallback />
    </div>
  );
}
