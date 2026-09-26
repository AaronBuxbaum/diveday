import {
  ShopPageHeaderSkeleton,
  SkeletonLineBars,
  type SkeletonLines,
} from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { settingsPaneClass } from "../_components/settings-pane";

/**
 * The register's shape: the header, then its groups of sheet rows, drawn as
 * the page draws them (pixel-craft class 11, 0px of shift on load).
 *
 * It hand-drew the header's three bars and three bordered, shadowed cards for
 * a page of ruled groups: a 36px title bar under a 44px line box, the
 * description `mt-3 h-4` under `mt-2` and 24px lines, so the groups dropped
 * 12px at 1280 and 36px at 390 on landing, and the cards became rows (K-447).
 * The header is the shared skeleton now, and each group is a label over the
 * ledger's rows at the row's own box: `SheetRow`'s name line and status line
 * beside its door, the door dropping under them on a phone (`stacked`).
 *
 * The groups are the seeded shop's: two sheets at the dock, two boats and the
 * site cards on the boat, one each for a diver and the wall. A status line
 * that wraps at 390 is drawn two lines deep there.
 */
const GROUPS: { label: string; rows: { metaLines: SkeletonLines; door: string }[] }[] = [
  {
    label: "w-48",
    rows: [
      { metaLines: { base: 2, sm: 1 }, door: "w-16" },
      { metaLines: 1, door: "w-16" },
    ],
  },
  {
    label: "w-24",
    rows: [
      { metaLines: 1, door: "w-16" },
      { metaLines: 1, door: "w-16" },
      { metaLines: 1, door: "w-16" },
    ],
  },
  { label: "w-24", rows: [{ metaLines: { base: 2, sm: 1 }, door: "w-28" }] },
  { label: "w-24", rows: [{ metaLines: 1, door: "w-28" }] },
];

export default function SettingsPrintLoading() {
  return (
    <main className={settingsPaneClass()}>
      <div className="animate-pulse">
        {/* The lede is one line from `sm` and two on a phone. */}
        <ShopPageHeaderSkeleton
          titleWidth="w-32"
          description
          descriptionWidth="w-[32rem] max-w-full"
          descriptionLines={{ base: 2, sm: 1 }}
        />
        {/* The page's one `space-y-10` between groups (K-521). */}
        <div className="space-y-10">
          {GROUPS.map((group, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records — the group's place is its only identity
            <div key={index}>
              {/* `LedgerGroup`'s label: a text-xs line, `mb-2` over its rows. */}
              <div className={`mb-2 h-4 ${group.label} rounded bg-surface-sunken`} />
              {group.rows.map((row, rowIndex) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records — the row's place is its only identity
                  key={rowIndex}
                  className={`flex min-h-13 items-center gap-3 py-2 max-sm:flex-wrap max-sm:gap-y-1 ${ledgerRowBoxClass}`}
                >
                  {/* The sheet's name (a 24px line), then its status (`mt-0.5`,
                      20px lines). */}
                  <div className="min-w-0 flex-1">
                    <div className="h-6 w-48 max-w-full rounded bg-surface-sunken" />
                    <div className="mt-0.5">
                      <SkeletonLineBars
                        lines={row.metaLines}
                        height="h-5"
                        width="w-72 max-w-full"
                      />
                    </div>
                  </div>
                  {/* The door: a 44px control overhanging the row's inset, on a
                      line of its own at the row's end on a phone. */}
                  <div className="-my-2 shrink-0 max-sm:my-0 max-sm:flex max-sm:basis-full max-sm:justify-end">
                    <div className={`h-11 ${row.door} rounded-lg bg-surface-sunken`} />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
