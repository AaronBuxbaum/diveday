import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for Lost and found: the title, then three hairline
 * rows the height of a found item with its line of facts and its buttons.
 */
export default function LostFoundLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton eyebrow={false} titleWidth="w-48" description={false} />
        <div className="divide-y divide-border">
          {[0, 1, 2].map((row) => (
            <div key={row} className="space-y-2 py-3">
              <div className="h-5 w-48 max-w-full rounded bg-surface-sunken" />
              <div className="h-4 w-72 max-w-full rounded bg-surface-sunken" />
              <div className="flex gap-2">
                <div className="h-11 w-28 rounded-lg bg-surface-sunken" />
                <div className="h-11 w-24 rounded-lg bg-surface-sunken" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
