import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for Requests (design principle 1): a day's group label
 * with its act to the right, the advice line under it, then the requests as
 * hairline rows on the page — the shape ADR 20260827-people-not-lists gave this
 * surface. The stack of bordered cards this used to draw went with the cards
 * themselves, so the skeleton and the page agree on height.
 */
function RequestRows({ count }: { count: number }) {
  return (
    <div className="mt-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static bars, no identity of their own
          key={index}
          className="flex items-center gap-4 border-t border-border py-3 last:border-b"
        >
          <div className="h-4 w-32 shrink-0 rounded bg-surface-sunken" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-surface-sunken" />
            <div className="h-3 w-1/2 rounded bg-surface-sunken" />
          </div>
          <div className="h-4 w-24 shrink-0 rounded bg-surface-sunken" />
        </div>
      ))}
    </div>
  );
}

export default function RequestsLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-72 max-w-full" descriptionWidth="w-64 max-w-full" />
        <div className="space-y-10">
          {[2, 1].map((rows) => (
            <div key={rows}>
              <div className="flex items-baseline justify-between gap-4">
                <div className="h-4 w-56 max-w-full rounded bg-surface-sunken" />
                <div className="h-10 w-36 shrink-0 rounded-lg bg-surface-sunken" />
              </div>
              <div className="mt-2 h-4 w-72 max-w-full rounded bg-surface-sunken" />
              <RequestRows count={rows} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
