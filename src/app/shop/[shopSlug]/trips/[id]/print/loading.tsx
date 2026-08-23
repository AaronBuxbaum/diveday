import { sectionCardClass } from "@/components/ui/card";

/**
 * Packet-shaped skeleton for the printable trip packet (ADR
 * 20260804-instant-navigation).
 *
 * Without this file the route fell back to
 * `src/app/shop/[shopSlug]/trips/[id]/loading.tsx`, which is a picture of the
 * *Overview* tab — one masthead and a four-card stack — while what arrives is
 * three stacked documents. The width needs no `max-w-*` of its own: like the
 * page, this renders as the trip layout's children, and that layout owns the
 * container.
 *
 * The packet assembles the dive plan, the manifest, and prep in one render, so
 * it is the slowest trip surface to arrive and the one most worth standing in
 * for — a staffer waiting at the printer sees the packet's own banner and its
 * three section blocks rather than a page they did not ask for.
 *
 * Shaped for the three `print-bundle-page` sections the packet renders since
 * the trip packet became a document (#814): the first carries the trip header
 * and `PacketDives`' prose, the other two the manifest and prep bodies.
 */
export default function TripPrintLoading() {
  return (
    <div className="animate-pulse">
      {/* The packet banner: the DiveDay eyebrow over the title, above the rule. */}
      <div className="mb-10 border-b border-border pb-6">
        <div className="h-3 w-20 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-64 max-w-full rounded bg-surface-sunken" />
      </div>

      {/* Section one: the trip header, then the dive plan as prose rather than
          cards — a description line, two numbered dives, and conditions. */}
      <div>
        <div className="h-9 w-96 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-5 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-5 w-full max-w-xl rounded bg-surface-sunken" />
        <div className="mt-4 flex flex-col gap-4">
          {[0, 1].map((dive) => (
            <div key={dive}>
              <div className="h-5 w-56 max-w-full rounded bg-surface-sunken" />
              <div className="mt-1 h-4 w-24 rounded bg-surface-sunken" />
              <div className="mt-1 h-4 w-full max-w-lg rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
        <div className="mt-5">
          <div className="h-4 w-28 rounded bg-surface-sunken" />
          <div className="mt-1 h-4 w-full max-w-lg rounded bg-surface-sunken" />
        </div>
      </div>

      {/* The manifest and prep bodies, each its own printed page. */}
      {["manifest", "prep"].map((section) => (
        <div key={section} className="mt-10">
          <div className="h-7 w-56 max-w-full rounded bg-surface-sunken" />
          <div className={sectionCardClass({ padding: "none", className: "mt-4 h-56" })} />
        </div>
      ))}
    </div>
  );
}
