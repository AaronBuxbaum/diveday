import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for a public dive-site page (ADR
 * 20260804-instant-navigation): the header block, the cover band the shop's
 * photograph fills, a run of prose bars for the briefing, and the hairline
 * rows the departures land in.
 *
 * The width tracks the page's own `max-w-4xl` column — without a file of its
 * own the route would fall back to the *schedule* skeleton at `max-w-6xl`, so
 * a diver would watch day headers at the wrong width and then land on a
 * narrower page.
 */
export default function DiveSitePageLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          titleWidth="w-72 max-w-full"
          descriptionWidth="w-96 max-w-full"
          meta={<div className="h-5 w-56 max-w-full rounded bg-surface-sunken" />}
        />
        <div className="aspect-[3/2] w-full rounded-panel bg-surface-sunken sm:aspect-[5/2]" />
        <div className="mt-8 space-y-3">
          <div className="h-3 w-24 rounded bg-surface-sunken" />
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-full rounded bg-surface-sunken" />
          <div className="h-4 w-2/3 rounded bg-surface-sunken" />
        </div>
        <div className="mt-8 h-3 w-40 rounded bg-surface-sunken" />
        <div className="mt-2 flex flex-col">
          {[0, 1, 2].map((row) => (
            <div key={row} className="border-t border-border py-4 last:border-b">
              <div className="h-4 w-40 rounded bg-surface-sunken" />
              <div className="mt-1.5 h-4 w-32 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
