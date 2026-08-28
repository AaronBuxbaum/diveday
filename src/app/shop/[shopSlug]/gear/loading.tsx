import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for the register (design principle 1), shaped to the
 * ledger it stands in for (ADR 20260827-the-shops-shelves): the kind-chip
 * band, then group labels over hairline rows. Not the three stat tiles and the
 * bordered table this route used to paint — a skeleton that outlives its page
 * is a layout jump with extra steps.
 */
export default function GearLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />
        {/* The chip band, at `FilterChips`' own 44px control height. No top
            margin of its own: the header skeleton's `mb-8` is the same gap the
            real page opens with, and doubling it is a layout jump. */}
        <div className="flex flex-wrap gap-2">
          {["w-20", "w-24", "w-28", "w-24"].map((width) => (
            <div key={width} className={`h-11 ${width} rounded-full bg-surface-sunken`} />
          ))}
        </div>
        <div className="mt-6 space-y-8">
          {[2, 4].map((rows, group) => (
            <div key={rows}>
              {/* The group label, at `GroupLabel`'s own height. */}
              <div className="h-4 w-32 rounded bg-surface-sunken" />
              <div className="mt-2">
                {Array.from({ length: rows }, (_unused, row) => (
                  <div
                    // Bars, not records: this list has a fixed length, never
                    // reorders, and holds no state — the position is the only
                    // identity a placeholder row has.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    key={`${group}-${row}`}
                    className="flex min-h-12 items-center justify-between gap-4 border-t border-border last:border-b"
                  >
                    <span className="flex w-full max-w-lg items-center gap-3 py-2">
                      <span className="block h-5 w-20 shrink-0 rounded bg-surface-sunken" />
                      <span className="block h-4 w-40 max-w-full rounded bg-surface-sunken" />
                    </span>
                    <span className="block h-8 w-24 shrink-0 rounded-lg bg-surface-sunken" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
