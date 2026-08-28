import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for a diver's record (design principle 1). Without one,
 * this route would inherit the roster's row-shaped skeleton from the parent
 * segment — a shape mismatch for a single record.
 *
 * It is shaped like the composition ADR 20260827-people-not-lists gave the
 * page, in the same order and at the same rhythm: masthead, the acts row, the
 * story's hairline rows, then the file's four inset groups. Deliberately
 * **no block where the status ledger goes** — the ledger renders nothing for a
 * clear diver, and a skeleton that always draws one would promise work that
 * usually is not there and jump when it resolves to nothing.
 */
export default function DiverProfileLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          titleWidth="w-56"
          description={false}
          meta={<div className="mt-2 h-5 w-72 max-w-full rounded bg-surface-sunken" />}
        />
        {/* Book a departure, then Edit details — the record's two act triggers. */}
        <div className="mt-1 flex flex-wrap gap-2">
          <div className="h-11 w-44 rounded-lg bg-surface-sunken" />
          <div className="h-11 w-32 rounded-lg bg-surface-sunken" />
        </div>
        {/* The story: a group label over hairline rows on the page background. */}
        <div className="mt-10">
          <div className="h-4 w-24 rounded bg-surface-sunken" />
          <div className="mt-3 divide-y divide-border border-t border-b border-border">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-14" />
            ))}
          </div>
        </div>
        {/* The file: four inset groups, each a label over one hairline shell. */}
        <div className="mt-8 flex flex-col gap-8">
          {["certifications", "waiver", "gear", "notes"].map((group) => (
            <div key={group}>
              <div className="h-4 w-28 rounded bg-surface-sunken" />
              <div className={sectionCardClass({ padding: "none", className: "mt-3 h-28" })} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
