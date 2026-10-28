import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** The title, compact day plan and booking decision, then supporting detail. */
export default function TripDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl">
      <div className="animate-pulse lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] lg:grid-rows-[auto_repeat(4,auto)_1fr] lg:gap-x-12 lg:gap-y-10">
        {/* No bar for a back link: the page dropped its standalone "← All
            trips" when the header's eyebrow became the way back, and the bar
            that outlived it put every line below 16px low (pixel-craft class
            11, K-264). */}
        {/* The hero, one cell of the grid as the page sets it. */}
        <div>
          <ShopPageHeaderSkeleton
            titleWidth="w-72 max-w-full"
            description={false}
            meta={
              <>
                <div className="h-7 w-56 max-w-full rounded bg-surface-sunken" />
                <div className="mt-4 h-9 w-36 rounded bg-surface-sunken" />
              </>
            }
          />
          {/* The hero's Add-to-calendar / Share row, `TripActions`: 16px under
            the header and a 44px target tall, on every page but the embed. */}
          <div className="mt-4 flex h-11 items-center">
            <div className="h-5 w-64 max-w-full rounded bg-surface-sunken" />
          </div>
        </div>
        <div className="mt-10 h-28 rounded bg-surface-sunken lg:mt-0 lg:col-start-1 lg:row-start-2" />
        {/* The same right-hand booking column as the loaded page. */}
        <div
          className={sectionCardClass({
            padding: "none",
            className: "mt-10 h-96 lg:mt-0 lg:col-start-2 lg:row-span-6 lg:row-start-1",
          })}
        />
        {/* The page's one stack of sections, 40px apart (pixel-craft class 4,
            K-162), on the same `mt-10 space-y-10` the page stands them on. */}
        <div className="mt-10 space-y-10 lg:contents lg:space-y-0">
          {/* The pitch, in its three parts — the fact chip, the three tiles,
              the door — with the conditions line flush under the door, one
              block as the page draws it. Flat bands on the page background,
              not cards. */}
          <div>
            <div className="h-7 w-40 rounded-full bg-surface-sunken" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="h-24 rounded bg-surface-sunken" />
              <div className="h-24 rounded bg-surface-sunken" />
              <div className="h-24 rounded bg-surface-sunken" />
            </div>
            <div className="mt-4 h-14 rounded bg-surface-sunken" />
            <div className="pt-4">
              <div className="h-12 rounded bg-surface-sunken" />
            </div>
          </div>
          {/* The two alternates. */}
          <div className="h-26 rounded bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
