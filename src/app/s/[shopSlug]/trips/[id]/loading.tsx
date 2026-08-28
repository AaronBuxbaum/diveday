import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for a trip's public detail page (design principle 1).
 * This page runs several parallel queries plus a conditional, timeout-bound
 * marine-forecast fetch, so a cold nav previously had a real beat with
 * nothing shaped to show meanwhile.
 *
 * Shaped like the body it stands in for, in the order that body now runs (ADR
 * 20260827-the-divers-thread, decision 2): back link, eyebrow, title, the
 * strong when-line, the price moment, the two flat pitch bands, then the one
 * raised booking card **last**. It held the old order — card, then a flat band
 * — until 2026-08-28, and a skeleton that promises a form where the pitch
 * lands is a layout jump wearing a placeholder's clothes. `max-w-xl` with the
 * page: the thread's one measure (decision 1).
 */
export default function TripDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-4">
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
        </div>
        {/* The pitch: "The day", "Look for", and the conditions line — flat
            bands on the page background, not cards. */}
        <div className="mt-8 h-28 rounded bg-surface-sunken" />
        <div className="mt-6 h-12 rounded bg-surface-sunken" />
        {/* The booking card's shell, from the same place `SectionCard` takes
            it — the one raised card the page streams in, and the last thing
            on it. */}
        <div className={sectionCardClass({ padding: "none", className: "mt-10 h-96" })} />
      </div>
    </main>
  );
}
