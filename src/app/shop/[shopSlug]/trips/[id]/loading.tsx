import { sectionCardClass } from "@/components/ui/card";
import { VoyageHeaderSkeleton } from "./_components/VoyageHeader";

/**
 * Body-shaped skeleton for the departure (design principle 1). Navigation into
 * one should keep its geometry while the reads settle: the header, the About
 * row, and the roster.
 *
 * **The header is the header's own lines** (`VoyageHeaderSkeleton`, exported
 * beside it so the two cannot drift; pixel-craft class 11). No heading bar
 * over the roster: the compact roster has none.
 *
 * **No bar under the header.** That block stood for the three-surface tab
 * strip, which is gone (ADR 20260919-one-idea, slice 23c) — the departure is
 * one page. Nor a shape for the packing list under the roster: that has its
 * own `<Suspense>` inside the page, so this frame is replaced before it
 * arrives.
 *
 * **The page's one gap.** Its blocks sit in one `space-y-10`, the header
 * included (K-262), so these do too: the header carries no margin of its own,
 * and the roster stands a section under About.
 */
export default function TripSurfaceLoading() {
  return (
    <div className="animate-pulse space-y-10">
      <VoyageHeaderSkeleton />

      <div className={sectionCardClass({ padding: "none", className: "h-16" })} />

      <div>
        <div className={sectionCardClass({ padding: "none", className: "h-80" })} />
        <div className="mt-6 h-11 w-44 rounded bg-surface-sunken" />
      </div>
    </div>
  );
}
