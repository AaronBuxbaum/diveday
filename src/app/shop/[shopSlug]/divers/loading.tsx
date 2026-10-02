import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

/**
 * Body-shaped skeleton for the Divers roster (design principle 1): the chip
 * row, the search line, and two letter groups of hairline rows — the shape the
 * ledger lands in (ADR 20260827-people-not-lists, decision 2), so a navigation
 * into the roster does not jump when the real page arrives. The card shell it
 * used to draw went with the table it stood in for.
 *
 * **Every shape is the loaded one's** (pixel-craft class 11;
 * `ledger-skeletons.test.tsx` pins them). It had fallen behind three changes
 * to the page, and on a phone the search box a staffer is about to type into
 * jumped 52px up when the roster arrived:
 *
 * - The chips are `FilterChips`' row: one line on a phone, where the page
 *   scrolls them, wrapping only from `sm` up. Four bars wrapped to two rows.
 * - The toolbar is `DiverList`'s: the `md` search box and "Add diver", 48px
 *   each and a line each on a phone, then the count's 20px line.
 * - The letter is the group label's 16px line, and each row a `LedgerRow`'s:
 *   52px at its floor, and on a phone the name over its fact, 48px of lines
 *   in the row's 8px inset.
 */
export default function DiversLoading() {
  return (
    // max-w-5xl to match the page it stands in for — the ledger's measure, and
    // the shop home's. A narrower skeleton made every navigation into the
    // roster slide sideways when the real page landed.
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} eyebrow={false} />
        <div className="mt-8 flex gap-2 max-sm:overflow-hidden sm:flex-wrap">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 w-28 shrink-0 rounded-full bg-surface-sunken" />
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-80" />
            <div className="h-12 w-32 rounded-lg bg-surface-sunken max-sm:w-full" />
          </div>
          <div className="my-0.5 h-4 w-24 rounded bg-surface-sunken" />
        </div>
        <div className="mt-8 flex flex-col gap-7">
          {[0, 1].map((group) => (
            <div key={group}>
              <div className="h-4 w-6 rounded bg-surface-sunken" />
              <div className="mt-2">
                {[0, 1, 2].map((row) => (
                  <div key={row} className={`flex min-h-13 items-center py-2 ${ledgerRowBoxClass}`}>
                    <div className="flex h-12 min-w-0 flex-1 flex-col justify-center gap-2 sm:h-6">
                      <div className="h-4 w-44 max-w-[60%] rounded bg-surface-sunken" />
                      <div className="h-3 w-32 max-w-[45%] rounded bg-surface-sunken sm:hidden" />
                    </div>
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
