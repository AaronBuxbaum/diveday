import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for the close-out (design principle 1) — header, the
 * departure end-state cards, the leftovers list, and the close panel have no
 * loading state of their own to show meanwhile.
 */
export default function CloseOutLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-72" descriptionWidth="w-96 max-w-full" />

        <div className="mt-10 h-5 w-56 rounded bg-surface-sunken" />
        <div className="mt-4 flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={`dep-${i}`} className="h-24 rounded-2xl border border-border bg-surface" />
          ))}
        </div>

        <div className="mt-10 h-5 w-44 rounded bg-surface-sunken" />
        <div className="mt-4 flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={`left-${i}`} className="h-24 rounded-2xl border border-border bg-surface" />
          ))}
        </div>

        <div className="mt-10 h-36 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
