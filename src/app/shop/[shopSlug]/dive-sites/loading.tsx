import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the dive-site library (design principle 1), shaped
 * to the ledger it stands in for (ADR 20260827-the-shops-shelves): the search
 * band, then group labels over hairline rows, then the catalog's tail door —
 * not the bordered table this surface used to be, which would land the real
 * page a layout jump away from its own skeleton.
 *
 * The search band keeps `sectionCardClass()`, because it is the one panel left
 * on this page; everything below it now sits on the page background under a
 * hairline, which is what the bars here draw.
 */
export default function DiveSitesLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-xl" />
        <div className={sectionCardClass({ className: "mt-6 h-24" })} />
        <div className="mt-8 space-y-8">
          {[3, 2].map((rows, group) => (
            <div key={rows}>
              {/* The group label, at `GroupLabel`'s own height. */}
              <div className="h-4 w-28 rounded bg-surface-sunken" />
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
                    <span className="block w-full max-w-64 py-2">
                      <span className="block h-5 w-40 max-w-full rounded bg-surface-sunken" />
                      <span className="mt-1 block h-4 w-56 max-w-full rounded bg-surface-sunken" />
                    </span>
                    <span className="block h-4 w-20 shrink-0 rounded bg-surface-sunken" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* The catalog door: the ledger's tail row, one hairline of its own. */}
        <div className="mt-10 flex min-h-12 items-center gap-3 border-y border-border">
          <span className="block size-5 shrink-0 rounded bg-surface-sunken" />
          <span className="block w-full py-2">
            <span className="block h-5 w-52 max-w-full rounded bg-surface-sunken" />
            <span className="mt-1 block h-4 w-32 rounded bg-surface-sunken" />
          </span>
        </div>
      </div>
    </main>
  );
}
