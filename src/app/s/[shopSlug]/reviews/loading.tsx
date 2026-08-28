import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for the public review archive (ADR
 * 20260804-instant-navigation).
 *
 * Without this file the route fell back to `src/app/s/[shopSlug]/loading.tsx`,
 * the *schedule* skeleton, at `max-w-6xl` — so a diver tapping "83 reviews"
 * watched day headers and departure rows at the wrong width and then landed on
 * a 4xl column of reviews. The width here tracks the page's own `max-w-4xl`
 * container, and the bars are shaped like the hairline rows `ReviewLedger`
 * renders (ADR 20260827-clearwater-surface-language, decision 2).
 */
export default function PublicReviewsLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" description={false} />

        {/* The aggregate, on one line: the star row, the figure, the count and
            the verification claim. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-5 w-28 rounded bg-surface-sunken" />
          <div className="h-5 w-72 max-w-full rounded bg-surface-sunken" />
        </div>

        {/* The ledger `ReviewLedger` renders — hairline rows, not a card grid. */}
        <div className="mt-4 flex flex-col">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="border-t border-border py-4 last:border-b">
              <div className="h-4 w-24 rounded bg-surface-sunken" />
              <div className="mt-1.5 h-5 w-96 max-w-full rounded bg-surface-sunken" />
              <div className="mt-1.5 h-4 w-48 max-w-full rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
