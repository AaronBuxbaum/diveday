import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

/**
 * Body-shaped skeleton for the Divers roster (design principle 1): the chip
 * search line, the chip row, and two letter groups of hairline rows — the shape the
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
 *   each and sharing one line, then the count’s 20px line.
 * - The letter is the group label's 16px line, and each row a `LedgerRow`'s:
 *   52px at its floor, and on a phone the name over its fact, 48px of lines
 *   in the row's 8px inset.
 */
export default function DiversLoading() {
  return (
    // `full`, to match the page it stands in for: the ledger's width, and the
    // shop home's. A narrower skeleton made every navigation into the
    // roster slide sideways when the real page landed.
    <StaffPage width="full">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" description={false} eyebrow={false} />
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="h-12 min-w-0 flex-1 rounded-lg bg-surface-sunken sm:w-80 sm:flex-none" />
            <div className="h-12 w-32 shrink-0 rounded-lg bg-surface-sunken" />
          </div>
          <div className="my-0.5 h-4 w-24 rounded bg-surface-sunken" />
        </div>
        <div className="mt-3 flex gap-2 max-sm:overflow-hidden sm:flex-wrap">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 w-28 shrink-0 rounded-full bg-surface-sunken" />
          ))}
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
    </StaffPage>
  );
}
