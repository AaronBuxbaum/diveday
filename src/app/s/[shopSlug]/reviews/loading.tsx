import { ShopPageHeaderSkeleton, SkeletonLineBars } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

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
 *
 * **Each bar stands in the line box it replaces** (pixel-craft class 11,
 * K-383): the aggregate's 24px line, the histogram's five 20px rows `gap-1.5`
 * apart, and in each review the 24px line the stars sit on (their parent's
 * strut), the 24px quote — two lines on a phone — and the 20px byline. It had
 * no histogram and 16px-short reviews, so the first one landed 144px below its
 * grey row.
 */
export default function PublicReviewsLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" description={false} />

        {/* The aggregate, on one 24px line: the star row, then the figure and
            the count. */}
        <div className="flex h-6 items-center gap-2">
          <div className="h-4 w-24 rounded bg-surface-sunken" />
          <div className="h-4 w-28 rounded bg-surface-sunken" />
        </div>

        {/* The five rating rows, one 20px `text-sm` line each. */}
        <div data-histogram className="mt-4 flex max-w-sm flex-col gap-1.5">
          {[5, 4, 3, 2, 1].map((rating) => (
            <div key={rating} className="flex h-5 items-center">
              <div className="h-1.5 w-full rounded bg-surface-sunken" />
            </div>
          ))}
        </div>

        {/* The ledger `ReviewLedger` renders — hairline rows, not a card grid. */}
        <div className="mt-4 flex flex-col">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className={`py-4 ${ledgerRowBoxClass}`}>
              <div className="flex h-6 items-center">
                <div className="h-4 w-24 rounded bg-surface-sunken" />
              </div>
              <div className="mt-1.5">
                <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-6" width="w-96 max-w-full" />
              </div>
              <div className="mt-1.5 h-5 w-48 max-w-full rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
