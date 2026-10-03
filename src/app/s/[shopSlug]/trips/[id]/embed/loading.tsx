import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { EmbedChromeCollapse } from "../../../_components/EmbedChromeCollapse";

/**
 * **The framed trip page, drawn as the frame draws it** (K-382). It used to
 * inherit the page's own skeleton — a centred 528px `max-w-xl` column with a
 * back-link bar, 64px under the frame's top — and then snap to the frame's
 * full-width `px-3 py-4` column, 12px from its edge and about 105px higher.
 *
 * The frame's page opens on the shop's own line where the page opens on its
 * way back (`TripHeader`'s `brand` block: the frame has no chrome above it),
 * has no calendar-and-share row, and draws its three field-guide tiles at the
 * frame's width, so they are 4:3 boxes rather than bars of a fixed height.
 * Below the tiles it keeps the page skeleton's order: the day's run, the
 * pitch's door, the conditions line, the alternates, then the one booking card
 * last. `loading.test.tsx` reads the column off the page's embed branch and
 * the header's box off `TripHeader`, and holds the body to the page
 * skeleton's, so none of them can drift from this. Nothing above it either:
 * `EmbedChromeCollapse` keeps the layout's chrome bar out of the frame.
 */
export default function EmbeddedTripLoading() {
  return (
    <>
      <EmbedChromeCollapse />
      <main className="w-full flex-1 px-3 py-4">
        <div className="animate-pulse lg:grid lg:grid-cols-[minmax(0,1fr)_25rem] lg:grid-rows-[auto_repeat(4,auto)_1fr] lg:gap-x-12 lg:gap-y-10">
          {/* No wrapper: `TripHeader` returns its header bare (K-170). */}
          <ShopPageHeaderSkeleton
            brand={{ base: 2, sm: 1 }}
            titleWidth="w-72 max-w-full"
            titleLines={{ base: 2, sm: 1 }}
            description={false}
            meta={
              <>
                {/* The when-line, the departure's own sentence, the price. */}
                <div className="h-7 w-56 max-w-full rounded bg-surface-sunken" />
                <div className="mt-3 h-6 w-64 max-w-full rounded bg-surface-sunken" />
                <div className="mt-4 h-9 w-36 rounded bg-surface-sunken" />
              </>
            }
          />
          {/* The page's one stack of sections, 40px apart (K-162), as the page
              skeleton stands them. */}
          <div className="mt-10 space-y-10 lg:contents lg:space-y-0">
            {/* "The day" — the run of dives, one row each. */}
            <div className="h-28 rounded bg-surface-sunken" />
            {/* The pitch: the fact chip, three tiles each over its name, the
                door, and the conditions line flush under it, one block. */}
            <div>
              <div className="h-7 w-40 rounded-full bg-surface-sunken" />
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((tile) => (
                  <div key={tile}>
                    <div className="aspect-[4/3] rounded-inset bg-surface-sunken" />
                    <div className="mt-1 h-4 w-3/4 rounded bg-surface-sunken" />
                  </div>
                ))}
              </div>
              <div className="mt-4 h-14 rounded bg-surface-sunken" />
              <div className="pt-4">
                <div className="h-12 rounded bg-surface-sunken" />
              </div>
            </div>
            {/* The alternates. */}
            <div className="h-26 rounded bg-surface-sunken" />
            {/* The booking card, last, from the same place `SectionCard` takes it. */}
            <div
              className={sectionCardClass({
                padding: "none",
                className: "h-96 lg:col-start-2 lg:row-span-6 lg:row-start-1",
              })}
            />
          </div>
        </div>
      </main>
    </>
  );
}
