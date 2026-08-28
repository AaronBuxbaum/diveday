import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for the Divers roster (design principle 1): the chip
 * row, the search line, and two letter groups of hairline rows — the shape the
 * ledger lands in (ADR 20260827-people-not-lists, decision 2), so a navigation
 * into the roster does not jump when the real page arrives. The card shell it
 * used to draw went with the table it stood in for.
 */
export default function DiversLoading() {
  return (
    // max-w-5xl to match the page it stands in for — the ledger's measure, and
    // the shop home's. A narrower skeleton made every navigation into the
    // roster slide sideways when the real page landed.
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} />
        <div className="mt-8 flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 w-28 rounded-full bg-surface-sunken" />
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-11 w-full max-w-sm rounded-lg bg-surface-sunken sm:w-80" />
          <div className="h-4 w-24 rounded bg-surface-sunken" />
        </div>
        <div className="mt-8 flex flex-col gap-7">
          {[0, 1].map((group) => (
            <div key={group}>
              <div className="h-3 w-6 rounded bg-surface-sunken" />
              <div className="mt-2">
                {[0, 1, 2].map((row) => (
                  <div
                    key={row}
                    className="flex min-h-12 items-center border-t border-border last:border-b"
                  >
                    <div className="h-4 w-44 max-w-[60%] rounded bg-surface-sunken" />
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
