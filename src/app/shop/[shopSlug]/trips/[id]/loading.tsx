import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the departure (design principle 1). Navigation into
 * one should keep its geometry while the reads settle: the masthead, the About
 * row, and the roster.
 *
 * **No bar under the masthead.** That block stood for the three-surface tab
 * strip, which is gone (ADR 20260919-one-idea, slice 23c) — the departure is
 * one page. Nor a shape for the packing list under the roster: that has its
 * own `<Suspense>` inside the page, so this frame is replaced before it
 * arrives.
 */
export default function TripSurfaceLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-2 h-10 w-80 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-6 w-72 max-w-full rounded bg-surface-sunken" />
      </div>

      <div className={sectionCardClass({ padding: "none", className: "h-16" })} />

      <section className="mt-10">
        <div className="h-7 w-56 max-w-full rounded bg-surface-sunken" />
        <div className={sectionCardClass({ padding: "none", className: "mt-5 h-80" })} />
        <div className="mt-6 h-11 w-44 rounded bg-surface-sunken" />
      </section>
    </div>
  );
}
