import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { LedgerRow } from "@/components/ui/ledger";
import { StaffSectionTabsSkeleton } from "../../_components/StaffSectionTabs";

/**
 * Body-shaped skeleton for the bench (design principle 1): the section's tab
 * strip, then two status groups of hairline rows, each row three lines deep —
 * whose it is, what is wrong, and the quiet line of pieces, technician and
 * promised day — because that is what a loaded row stands at.
 */
export default function WorkOrdersLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-40" description={false} actions />
        <StaffSectionTabsSkeleton section="gear" />
        <div className="mt-6 space-y-9">
          {[
            { key: "received", rows: 2 },
            { key: "ready", rows: 3 },
          ].map(({ key, rows }) => (
            <div key={key}>
              <div className="h-4 w-36 rounded bg-surface-sunken" />
              <div className="mt-2.5">
                {Array.from({ length: rows }, (_unused, row) => (
                  <LedgerRow
                    as="div"
                    // Bars, not records: fixed length, no reordering, no state.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    key={`${key}-${row}`}
                    trailing={<span className="block h-4 w-16 rounded bg-surface-sunken" />}
                  >
                    <span className="flex w-full max-w-lg flex-col gap-1">
                      <span className="block h-5 w-40 rounded bg-surface-sunken" />
                      <span className="block h-4 w-56 max-w-full rounded bg-surface-sunken" />
                      <span className="block h-3 w-44 max-w-full rounded bg-surface-sunken" />
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
