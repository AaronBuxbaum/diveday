import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for a trip's public detail page (design principle 1).
 * This page runs several parallel queries plus a conditional, timeout-bound
 * marine-forecast fetch, so a cold nav previously had a real beat with
 * nothing shaped to show meanwhile.
 *
 * Shaped like the body it stands in for, in the order that body now runs (ADR
 * 20260827-the-divers-thread, decision 2, recomposed by ADR
 * 20260904-reef-all-the-way-down, decision 1): back link, eyebrow, title, the
 * strong when-line, the price moment, the day's run of dives, the pitch — a
 * fact chip, three field-guide tiles and one door — the conditions line, two
 * alternates, then the one raised booking card **last**. It held the old order
 * — card, then a flat band — until 2026-08-28, and a skeleton that promises a
 * form where the pitch lands is a layout jump wearing a placeholder's clothes.
 * `max-w-xl` with the page: the thread's one measure (decision 1).
 */
export default function TripDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
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
        {/* The page's one stack of sections, 40px apart (pixel-craft class 4,
            K-162), on the same `mt-10 space-y-10` the page stands them on. */}
        <div className="mt-10 space-y-10">
          {/* "The day" — the run of dives, one row each. */}
          <div className="h-28 rounded bg-surface-sunken" />
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
          {/* The booking card's shell, from the same place `SectionCard` takes
              it — the one raised card the page streams in, and the last thing
              on it. */}
          <div className={sectionCardClass({ padding: "none", className: "h-96" })} />
        </div>
      </div>
    </main>
  );
}
