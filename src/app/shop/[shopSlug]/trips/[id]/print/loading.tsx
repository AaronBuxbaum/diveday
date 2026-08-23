import { sectionCardClass } from "@/components/ui/card";

/**
 * Packet-shaped skeleton for the printable trip packet (ADR
 * 20260804-instant-navigation).
 *
 * Without this file the route fell back to
 * `src/app/shop/[shopSlug]/trips/[id]/loading.tsx`, which is a picture of the
 * *Overview* tab — one masthead and a four-card stack — while what arrives is
 * four stacked documents. The width needs no `max-w-*` of its own: like the
 * page, this renders as the trip layout's children, and that layout owns the
 * container.
 *
 * The packet assembles Overview, Guests, Manifest, and Prep in one render, so
 * it is the slowest trip surface to arrive and the one most worth standing in
 * for — a staffer waiting at the printer sees the packet's own banner and its
 * four section blocks rather than a page they did not ask for.
 */
export default function TripPrintLoading() {
  return (
    <div className="animate-pulse">
      {/* The packet banner: the DiveDay eyebrow over the title, above the rule. */}
      <div className="mb-10 border-b border-border pb-6">
        <div className="h-3 w-20 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-64 max-w-full rounded bg-surface-sunken" />
      </div>

      {/* One block per composed tab — Overview, Guests, Manifest, Prep. */}
      {["overview", "guests", "manifest", "prep"].map((section, index) => (
        <div key={section} className={index === 0 ? "" : "mt-10"}>
          <div className="h-7 w-56 max-w-full rounded bg-surface-sunken" />
          <div className={sectionCardClass({ padding: "none", className: "mt-4 h-56" })} />
        </div>
      ))}
    </div>
  );
}
