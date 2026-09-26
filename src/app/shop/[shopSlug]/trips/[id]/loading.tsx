import { sectionCardClass } from "@/components/ui/card";
import { VoyageHeaderSkeleton } from "./_components/VoyageHeader";

/**
 * Body-shaped skeleton for the departure (design principle 1). Navigation into
 * one should keep its geometry while the reads settle: the band, the About
 * row, and the roster.
 *
 * **The band is the band's own box** (`VoyageHeaderSkeleton`, exported beside
 * it so the two cannot drift). This drew the retired masthead's three bars on
 * the page ground, so the sky arrived when the page landed and the About card
 * dropped 171px at 1280 (pixel-craft class 11). Nor a heading bar over the
 * roster: the compact roster has none, and follows About at its own `mt-5`.
 *
 * **No bar under the band.** That block stood for the three-surface tab
 * strip, which is gone (ADR 20260919-one-idea, slice 23c) — the departure is
 * one page. Nor a shape for the packing list under the roster: that has its
 * own `<Suspense>` inside the page, so this frame is replaced before it
 * arrives.
 */
export default function TripSurfaceLoading() {
  return (
    <div className="animate-pulse">
      <VoyageHeaderSkeleton />

      <div className={sectionCardClass({ padding: "none", className: "h-16" })} />

      <div className={sectionCardClass({ padding: "none", className: "mt-5 h-80" })} />
      <div className="mt-6 h-11 w-44 rounded bg-surface-sunken" />
    </div>
  );
}
