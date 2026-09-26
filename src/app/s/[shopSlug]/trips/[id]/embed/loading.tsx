import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

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
 * the header's box off `TripHeader`, so neither can drift from this.
 */
export default function EmbeddedTripLoading() {
  return (
    <main className="w-full flex-1 px-3 py-4">
      <div className="animate-pulse">
        <div className="mt-4">
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
        </div>
        {/* "The day" — the run of dives, one row each. */}
        <div className="mt-8 h-28 rounded bg-surface-sunken" />
        {/* The pitch: the fact chip, three tiles each over its name, the door. */}
        <div className="mt-8 h-7 w-40 rounded-full bg-surface-sunken" />
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((tile) => (
            <div key={tile}>
              <div className="aspect-[4/3] rounded-inset bg-surface-sunken" />
              <div className="mt-1 h-4 w-3/4 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
        <div className="mt-4 h-14 rounded bg-surface-sunken" />
        {/* The conditions line, then the alternates. */}
        <div className="mt-6 h-12 rounded bg-surface-sunken" />
        <div className="mt-8 h-26 rounded bg-surface-sunken" />
        {/* The booking card, last, from the same place `SectionCard` takes it. */}
        <div className={sectionCardClass({ padding: "none", className: "mt-10 h-96" })} />
      </div>
    </main>
  );
}
