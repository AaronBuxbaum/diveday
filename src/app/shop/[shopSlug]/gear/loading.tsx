import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { LedgerRow } from "@/components/ui/ledger";

/**
 * One stub per chip a working register shows — All, nine kinds and the
 * service-due view — at those chips' widths, so the band wraps where the
 * loaded one does: to a second line at 1280, not one line of four that gained
 * 52px when the page arrived (K-430).
 */
const CHIP_STUBS = [
  ["all", "w-21"],
  ["bcd", "w-21"],
  ["regulator", "w-30"],
  ["wetsuit", "w-26"],
  ["boots", "w-24"],
  ["mask", "w-23"],
  ["fins", "w-21"],
  ["computer", "w-39"],
  ["gopro", "w-24"],
  ["tank", "w-22"],
  ["service-due", "w-34"],
] as const;

/**
 * Body-shaped skeleton for the register (design principle 1), shaped to the
 * ledger it stands in for (ADR 20260827-the-shops-shelves): the kind-chip
 * band, then group labels over hairline rows. Not the three stat tiles and the
 * bordered table this route used to paint — a skeleton that outlives its page
 * is a layout jump with extra steps.
 *
 * The rows are `LedgerRow`s, so they stand at the loaded row's floor and inset
 * by construction: hand-drawn, they kept the 48px the row read until
 * 2026-09-02 and every row landed 4px taller (K-430).
 */
export default function GearLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton eyebrow={false} description={false} />
        {/* The chip band, laid out as `FilterChips` lays it: one line that
            scrolls on a phone, wrapping only from `sm`, at the chips' 44px.
            No top margin of its own: the header skeleton's `mb-8` is the same
            gap the real page opens with, and doubling it is a layout jump. */}
        <div className="flex gap-2 max-sm:overflow-hidden sm:flex-wrap">
          {CHIP_STUBS.map(([chip, width]) => (
            <div key={chip} className={`h-11 ${width} shrink-0 rounded-full bg-surface-sunken`} />
          ))}
        </div>
        <div className="mt-6 space-y-8">
          {/* Out, whose rows carry an act, then the wall, whose rows carry
              only the door's chevron. */}
          {[
            { rows: 2, act: true },
            { rows: 4, act: false },
          ].map(({ rows, act }, group) => (
            <div key={rows}>
              {/* The group label, at `GroupLabel`'s own height. */}
              <div className="h-4 w-32 rounded bg-surface-sunken" />
              <div className="mt-2">
                {Array.from({ length: rows }, (_unused, row) => (
                  <LedgerRow
                    as="div"
                    // Bars, not records: this list has a fixed length, never
                    // reorders, and holds no state — the position is the only
                    // identity a placeholder row has.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    key={`${group}-${row}`}
                    trailing={
                      act ? <span className="block h-11 w-32 rounded-lg bg-surface-sunken" /> : null
                    }
                  >
                    <span className="flex w-full max-w-lg items-center gap-3">
                      <span className="block h-5 w-20 shrink-0 rounded bg-surface-sunken" />
                      <span className="block h-4 w-40 max-w-full rounded bg-surface-sunken" />
                    </span>
                  </LedgerRow>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
