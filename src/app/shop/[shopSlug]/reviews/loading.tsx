import { ShopPageHeaderSkeleton, SkeletonLineBars } from "@/components/ShopPageHeader";
import { LedgerRow } from "@/components/ui/ledger";

/**
 * Body-shaped skeleton for Reviews (design principle 1): the aggregate line
 * under the title, then the worklist group and the published run beneath it,
 * as hairline rows on the page rather than a stack of cards — the shape ADR
 * 20260827-people-not-lists gave this page. The four stat tiles this used to
 * draw are gone with the tiles themselves, and the meta bar stands in for the
 * one line that replaced them, so the skeleton and the page agree on height.
 *
 * **Each row is `ReviewLedgerRow`'s own `LedgerRow`** — `stacked`, at the
 * 12px `lg` inset — holding the row's stack: the 24px star line, a quote line
 * (16px type waiting, 14px published) and the meta line, each `mt-1` under the
 * last. Fixed `h-20` and `h-14` bars stood in for rows of 97 and 69–94px at
 * 1280 and ignored the phone, where the row's act drops to a 44px line of its
 * own, so every row under the first slid down on arrival (K-436).
 */
function LedgerRows({ count, quote }: { count: number; quote: "h-6" | "h-5" }) {
  return (
    <div className="mt-2">
      {Array.from({ length: count }, (_, index) => (
        <LedgerRow
          as="div"
          stacked
          pad="lg"
          // biome-ignore lint/suspicious/noArrayIndexKey: static bars, no identity of their own
          key={index}
          trailing={<div className="h-11 w-28 rounded-lg bg-surface-sunken" />}
        >
          <div className="h-6 w-24 rounded bg-surface-sunken" />
          <div className={`mt-1 ${quote} w-full max-w-md rounded bg-surface-sunken`} />
          <div className="mt-1 h-4 w-56 max-w-full rounded bg-surface-sunken" />
        </LedgerRow>
      ))}
    </div>
  );
}

export default function ReviewsLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        {/* The aggregate line wraps to two lines at 390px, one at 1280; the
            "View public page" door stacks under it on a phone (K-86). */}
        <ShopPageHeaderSkeleton
          description={false}
          meta={
            <SkeletonLineBars lines={{ base: 2, sm: 1 }} height="h-5" width="w-72 max-w-full" />
          }
          actions
        />
        <div className="space-y-10">
          <div>
            <div className="h-4 w-40 rounded bg-surface-sunken" />
            <LedgerRows count={2} quote="h-6" />
          </div>
          <div>
            <div className="h-4 w-32 rounded bg-surface-sunken" />
            <LedgerRows count={4} quote="h-5" />
          </div>
        </div>
      </div>
    </main>
  );
}
