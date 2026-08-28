import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for Reports (design principle 1) — the monthly
 * revenue/fill-rate/waiver-completion rollup has no loading state to show
 * meanwhile.
 *
 * Shaped to the page as ADR 20260827-the-shops-shelves recomposed it: a
 * hairline-bounded band of five figures, the quiet tax/CSV line under it, then
 * the departures ledger. It painted five bordered cards over one tall card
 * until that slice landed — and a skeleton of the previous page is a layout
 * jump on every navigation into the route, which is the one thing this file
 * exists to prevent.
 */
export default function ReportsLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-80 max-w-full" />
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="h-6 w-40 rounded bg-surface-sunken" />
          <div className="flex flex-wrap gap-2">
            <div className="h-11 w-11 rounded-lg bg-surface-sunken" />
            <div className="h-11 w-40 rounded-lg bg-surface-sunken" />
            <div className="h-11 w-11 rounded-lg bg-surface-sunken" />
          </div>
        </div>
        {/* The figure row: unboxed, one hairline above and below, and the same
            one/two/five column run the figures themselves wear. */}
        <div className="grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className={`py-5 pe-6 ${
                index === 0
                  ? ""
                  : index === 1
                    ? "border-t border-border sm:border-t-0"
                    : "border-t border-border lg:border-t-0"
              } ${
                index === 0
                  ? ""
                  : index % 2 === 1
                    ? "sm:border-s sm:border-border sm:ps-6"
                    : "lg:border-s lg:border-border lg:ps-6"
              } ${index === 4 ? "sm:col-span-2 lg:col-span-1" : ""}`}
            >
              <div className="h-3 w-20 rounded bg-surface-sunken" />
              <div className="mt-3 h-8 w-28 rounded bg-surface-sunken" />
              <div className="mt-3 h-3 w-24 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <div className="h-4 w-56 rounded bg-surface-sunken" />
        </div>
        <div className="mt-10 h-3 w-32 rounded bg-surface-sunken" />
        <div className="mt-2">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              className="flex min-h-12 items-center gap-4 border-t border-border last:border-b"
            >
              <div className="h-4 flex-1 rounded bg-surface-sunken" />
              <div className="hidden h-4 w-28 rounded bg-surface-sunken sm:block lg:w-52" />
              <div className="hidden h-4 w-12 rounded bg-surface-sunken sm:block lg:w-20" />
              <div className="hidden h-4 w-28 rounded bg-surface-sunken sm:block lg:w-52" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
