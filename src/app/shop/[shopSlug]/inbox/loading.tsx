import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the shop inbox (design principle 1): a group label,
 * then hairline message rows inside the inset shell the page draws — the
 * channel word on the left, the sender and their sentence in the middle, the
 * row's acts on the right.
 */
function MessageRows({ count }: { count: number }) {
  return (
    <div className={sectionCardClass({ padding: "none", className: "divide-y divide-border" })}>
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static bars, no identity of their own
          key={index}
          className="flex min-h-13 items-center gap-3 px-4 py-3"
        >
          <div className="h-4 w-20 shrink-0 rounded bg-surface-sunken" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-40 max-w-full rounded bg-surface-sunken" />
            <div className="h-3 w-3/4 rounded bg-surface-sunken" />
          </div>
          <div className="h-8 w-28 shrink-0 rounded-lg bg-surface-sunken" />
        </div>
      ))}
    </div>
  );
}

export default function InboxLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-72 max-w-full" description={false} />
        <div className="space-y-10">
          {[3, 2].map((count) => (
            <div key={count}>
              <div className="mb-3 h-3 w-32 rounded bg-surface-sunken" />
              <MessageRows count={count} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
