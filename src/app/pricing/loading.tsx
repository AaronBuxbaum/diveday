import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooterFallback } from "@/components/MarketingFooter";
import { SkeletonLineBars } from "@/components/ShopPageHeader";

/** The invoice's eight lines, as the page lists them. */
const INVOICE_ROWS = [
  "setup",
  "logins",
  "tiers",
  "cut",
  "cards",
  "contract",
  "trial",
  "leaving",
] as const;

/**
 * What the plan covers, one entry per item with the lines it wraps to on a
 * phone (measured at 390); from `sm` the list is two columns whose rows are
 * each two lines.
 */
const COVERS_LINES = [
  ["item1", 3],
  ["item2", 1],
  ["item3", 2],
  ["item4", 2],
  ["item6", 1],
  ["item7", 3],
] as const;

/**
 * The `/pricing` segment's `<Suspense>` boundary, and what a client navigation
 * into it paints (ADR 20260804-instant-navigation). Same arrangement, and the
 * same reason, as `src/app/product/loading.tsx`: the page's `requestLocale()`
 * read sits above everything it renders, so the chrome is here too, and the
 * body is bars rather than a second English render of itself
 * (FU-20260812-marketing-suspense-swap-discards-interaction). Nothing in here
 * is interactive; anything interactive added reopens that bug.
 *
 * **Shaped like the hero, in the hero's order and on its measure** (K-408):
 * the plan line, the headline, the figure, its cadence and the lock note, the
 * annotated invoice beside its notes, the two doors and their terms, then
 * the hairline turn into what the number buys. It predated the invoice and
 * drew the older order on `max-w-3xl`, so the doors painted where the invoice
 * lands and dropped 425px when it did. The numbers are the page's line boxes
 * (src/app/pricing/page.tsx), measured at 390 and 1280:
 *   - the eyebrow, one 20px `text-sm` line; the headline `mt-5`, two 40px
 *     `text-4xl` lines on a phone and one 48px `sm:text-5xl` line from `sm`;
 *   - the figure `mt-10`, `leading-none` at `text-7xl`/`sm:text-8xl`: 72/96px;
 *   - the cadence `mt-4`, one 24px line; the lock note `mt-2`, 24px lines,
 *     two on a phone;
 *   - the invoice `mt-12`: eight `py-3` rows of one 24px line between
 *     hairlines, beside (from `lg`) or over the notes, a 20px heading and
 *     four two-line notes `space-y-3` under it;
 *   - the doors `mt-12`, 48px, stacked below `sm`; the demo note `mt-6` (two
 *     lines on a phone, one from `sm`) and the trial note `mt-2` (three, then
 *     two), 24px lines;
 *   - the hairline `mt-14`, its 20px heading, the list `mt-5 gap-y-3`, the
 *     48px link `mt-4` and the fees note `mt-8`.
 */
export default function PricingLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <main className="flex-1 animate-pulse">
        <section className="border-b border-border">
          <div className="mx-auto max-w-4xl px-6 pt-20 pb-16 lg:pt-28 lg:pb-20">
            <div className="mx-auto flex max-w-3xl flex-col items-center">
              <div className="h-5 w-52 rounded bg-surface-sunken" />
              <div className="mt-5 w-full">
                <SkeletonLineBars
                  lines={{ base: 2, sm: 1 }}
                  height="h-10 sm:h-12"
                  width="mx-auto w-full max-w-xl"
                />
              </div>
              <div className="mt-10 h-18 w-40 rounded bg-surface-sunken sm:h-24 sm:w-52" />
              <div className="mt-4 h-6 w-32 rounded bg-surface-sunken" />
              <div className="mt-2 w-full">
                <SkeletonLineBars
                  lines={{ base: 2, sm: 1 }}
                  height="h-6"
                  width="mx-auto w-96 max-w-full"
                />
              </div>
            </div>

            {/* The annotated invoice, and the builder's notes beside it. */}
            <div className="mt-12 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
              <div className="divide-y divide-border border-y border-border">
                {INVOICE_ROWS.map((row) => (
                  <div key={row} className="flex items-center justify-between gap-6 py-3">
                    <div className="my-1 h-4 w-28 rounded bg-surface-sunken" />
                    <div className="my-1 h-4 w-24 rounded bg-surface-sunken" />
                  </div>
                ))}
              </div>
              <div>
                <div className="h-5 w-44 rounded bg-surface-sunken" />
                <div className="mt-4 space-y-3">
                  {["note1", "note2", "note3", "note4"].map((note) => (
                    <div key={note}>
                      <SkeletonLineBars lines={2} height="h-6" width="w-full" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* The two doors, and what each one costs. */}
            <div className="mx-auto flex max-w-3xl flex-col items-center">
              <div className="mt-12 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
                <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-48" />
                <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-36" />
              </div>
              <div className="mt-6 w-full">
                <SkeletonLineBars
                  lines={{ base: 2, sm: 1 }}
                  height="h-6"
                  width="mx-auto w-full max-w-lg"
                />
              </div>
              <div className="mt-2 w-full">
                <SkeletonLineBars
                  lines={{ base: 3, sm: 2 }}
                  height="h-6"
                  width="mx-auto w-full max-w-xl"
                />
              </div>
            </div>

            {/* What the number buys: the hairline, then a two-column list. */}
            <div className="mt-14 border-t border-border pt-10">
              <div className="h-5 w-44 rounded bg-surface-sunken" />
              <div className="mt-5 grid gap-x-10 gap-y-3 sm:grid-cols-2">
                {COVERS_LINES.map(([item, lines]) => (
                  <div key={item}>
                    <SkeletonLineBars
                      lines={{ base: lines, sm: 2 }}
                      height="h-6"
                      width="w-full max-w-xs"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex h-12 items-center">
                <div className="h-4 w-56 rounded bg-surface-sunken" />
              </div>
              <div className="mt-8">
                <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-6" width="w-full max-w-xl" />
              </div>
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
