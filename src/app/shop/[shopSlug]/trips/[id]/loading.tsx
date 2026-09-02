import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for the Trip surface (design principle 1). The route
 * owns the full masthead now, so the loading frame includes the three-surface
 * spine and the compact About/roster shapes that replace it. Navigation into
 * a departure should keep its geometry while the two data reads settle.
 */
export default function TripSurfaceLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        <div className="h-4 w-24 rounded bg-surface-sunken" />
        <div className="mt-2 h-10 w-80 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-6 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-11 w-full rounded-inset bg-surface-sunken" />
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
