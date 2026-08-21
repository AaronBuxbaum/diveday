import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the trip Overview (design principle 1). It renders
 * as the layout's children, so the sub-nav above stays put and only this area
 * flickers to a skeleton while the next tab's data loads — the tab switch
 * reads as instant instead of a blank hang.
 *
 * The bars mirror the page's own shapes: the masthead (title, date line,
 * identity line), the pulse (headline, seat strip, one fact), then the
 * section-card stack at the page's `mt-10 space-y-6` rhythm — same widths,
 * same gaps, so the page landing moves nothing sideways.
 */
export default function TripSurfaceLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        {/* text-4xl title line box */}
        <div className="h-10 w-80 max-w-full rounded bg-surface-sunken" />
        {/* text-base date line, mt-3 like the header's */}
        <div className="mt-3 h-6 w-64 max-w-full rounded bg-surface-sunken" />
        {/* text-sm identity line */}
        <div className="mt-2 h-5 w-96 max-w-full rounded bg-surface-sunken" />
      </div>
      <div className="mt-8">
        {/* the pulse: headline, seat strip, one fact row */}
        <div className="h-7 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-3.5 w-full max-w-sm rounded bg-surface-sunken" />
        <div className="mt-2 h-6 w-72 max-w-full rounded bg-surface-sunken" />
      </div>
      <div className="mt-10 space-y-6">
        {["details", "requirements", "crew", "conditions"].map((section) => (
          <div key={section} className={sectionCardClass({ padding: "lg", className: "h-44" })} />
        ))}
      </div>
    </div>
  );
}
