import { sectionCardClass } from "@/components/ui/card";

/**
 * Packet-shaped skeleton for the paper day (ADR 20260804-instant-navigation).
 *
 * Shaped like the document that arrives: the sheet's banner (eyebrow, title,
 * and the line naming the day and its boat count), then two departure blocks,
 * each a trip header over a dive plan and the two composed bodies. Two rather
 * than one because a day with a single boat has no need of this page, and two
 * is what makes the column read as a repeat rather than a page.
 *
 * The packet is the slowest staff surface to assemble — it composes the
 * manifest and prep readers once per departure — so this is the skeleton most
 * worth shaping honestly.
 */
export default function ShopDayPrintLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-10 border-b border-border pb-6">
        <div className="h-3 w-20 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-56 max-w-full rounded bg-surface-sunken" />
      </div>

      {[0, 1].map((departure) => (
        <div key={departure} className="mt-10 first:mt-0">
          <div className="h-9 w-96 max-w-full rounded bg-surface-sunken" />
          <div className="mt-3 h-5 w-72 max-w-full rounded bg-surface-sunken" />
          <div className="mt-6 flex flex-col gap-4">
            {[0, 1].map((dive) => (
              <div key={dive}>
                <div className="h-5 w-56 max-w-full rounded bg-surface-sunken" />
                <div className="mt-1 h-4 w-24 rounded bg-surface-sunken" />
                <div className="mt-1 h-4 w-full max-w-lg rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
          {["manifest", "prep"].map((section) => (
            <div key={section} className="mt-8">
              <div className="h-7 w-56 max-w-full rounded bg-surface-sunken" />
              <div className={sectionCardClass({ padding: "none", className: "mt-4 h-56" })} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
