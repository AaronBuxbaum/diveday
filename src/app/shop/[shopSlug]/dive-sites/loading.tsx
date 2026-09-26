import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

/**
 * Body-shaped skeleton for the dive-site library (design principle 1), shaped
 * to the ledger it stands in for (ADR 20260827-the-shops-shelves): the search
 * box, then group labels over hairline rows, then the catalog's tail door —
 * not the bordered table this surface used to be, which would land the real
 * page a layout jump away from its own skeleton.
 *
 * **Each bar is the loaded box it stands for** (docs/design/pixel-craft.md,
 * class 11; K-415). The search is a toolbar, not a card: one 48px `md`
 * `SearchField`, full width on a phone and 320px from `sm`, in a `mb-6` form.
 * A row is `LedgerRow`'s `md` box, a 24px name over a 20px meta line inside
 * its `py-2`, 63px with its rule; it stood a 96px card and 56px rows here, so
 * the list jumped up on arrival and every row under it grew.
 *
 * The `?view=catalog` view has another shape, which this one route file cannot
 * draw.
 */
export default function DiveSitesLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} actions />
        {/* The search box, in the `mb-6` toolbar the page draws it in. */}
        <div className="mb-6 h-12 w-full rounded-lg bg-surface-sunken sm:w-80" />
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
                    className={`flex min-h-13 items-center justify-between gap-4 ${ledgerRowBoxClass}`}
                  >
                    <SiteLineBars nameWidth="w-40" metaWidth="w-56" />
                    <span className="block h-5 w-20 shrink-0 rounded bg-surface-sunken" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* The catalog door: the ledger's tail row, one `LedgerRow` of its own
            with the pin leading, so the same box and the same two lines. */}
        <div className="mt-10">
          <div className={`flex min-h-13 items-center gap-3 ${ledgerRowBoxClass}`}>
            <span className="block size-5 shrink-0 rounded bg-surface-sunken" />
            <SiteLineBars nameWidth="w-52" metaWidth="w-32" />
          </div>
        </div>
      </div>
    </main>
  );
}

/** A row's two lines: the `font-medium` name's 24px line, then the `mt-0.5` meta's 20px. */
function SiteLineBars({ nameWidth, metaWidth }: { nameWidth: string; metaWidth: string }) {
  return (
    <span className="block w-full max-w-64 py-2">
      <span className={`block h-6 ${nameWidth} max-w-full rounded bg-surface-sunken`} />
      <span className={`mt-0.5 block h-5 ${metaWidth} max-w-full rounded bg-surface-sunken`} />
    </span>
  );
}
