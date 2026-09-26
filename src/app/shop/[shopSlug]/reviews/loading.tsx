import { ShopPageHeaderSkeleton, SkeletonLineBars } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

/**
 * Body-shaped skeleton for Reviews (design principle 1): the aggregate line
 * under the title, then the worklist group and the published run beneath it,
 * as hairline rows on the page rather than a stack of cards — the shape ADR
 * 20260827-people-not-lists gave this page. The four stat tiles this used to
 * draw are gone with the tiles themselves, and the meta bar stands in for the
 * one line that replaced them, so the skeleton and the page agree on height.
 */
function LedgerRows({ count, height }: { count: number; height: string }) {
  return (
    <div className="mt-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static bars, no identity of their own
          key={index}
          className={`flex items-center gap-3 ${height} ${ledgerRowBoxClass}`}
        >
          <div className="h-4 w-20 shrink-0 rounded bg-surface-sunken" />
          <div className="h-4 flex-1 rounded bg-surface-sunken" />
          <div className="h-8 w-28 shrink-0 rounded-lg bg-surface-sunken" />
        </div>
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
            <LedgerRows count={2} height="h-20" />
          </div>
          <div>
            <div className="h-4 w-32 rounded bg-surface-sunken" />
            <LedgerRows count={4} height="h-14" />
          </div>
        </div>
      </div>
    </main>
  );
}
