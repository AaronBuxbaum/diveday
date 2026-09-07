import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for the inbox (design principle 1): a group label, then
 * hairline rows on the page carrying a channel word, a name, and what was
 * written. The same shape `InboxRow` renders, so the page landing under it
 * does not jump.
 */
function MessageRows({ count }: { count: number }) {
  return (
    <div className="mt-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static bars, no identity of their own
          key={index}
          className="flex items-center gap-3 border-t border-border py-3 last:border-b"
        >
          <div className="h-4 w-20 shrink-0 rounded bg-surface-sunken" />
          <div className="h-4 w-32 shrink-0 rounded bg-surface-sunken max-sm:hidden" />
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

export default function InboxLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-72 max-w-full" description={false} />
        <div className="space-y-10">
          {[3, 2].map((rows) => (
            <div key={rows}>
              <div className="h-4 w-40 max-w-full rounded bg-surface-sunken" />
              <MessageRows count={rows} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
