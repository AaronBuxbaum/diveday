import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for `/recap` (design principle 1), shaped like the
 * thread's after-state that replaces it (ADR 20260827-the-divers-thread,
 * decision 4): the coral greeting, the dive record, the crew's word, the one
 * review ask, the private pulse beside it, the run of quiet doors, and the one
 * next dive under them (slice 16i of ADR 20260904-reef-all-the-way-down).
 *
 * Same measure as `/ready`'s, because they are one surface on two URLs now.
 */
export default function RecapLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <div className="animate-pulse">
        {/* The greeting, which is this state's earned moment: one block. */}
        <div className={sectionCardClass({ padding: "none", className: "h-36" })} />
        {/* The dive record — the only thing on the page that prints. */}
        <div className={sectionCardClass({ padding: "none", className: "mt-8 h-72" })} />
        {/* The crew's word. */}
        <div className="mt-10 h-6 w-full max-w-md rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-40 rounded bg-surface-sunken" />
        {/* The one ask. */}
        <div className={sectionCardClass({ padding: "none", className: "mt-10 h-64" })} />
        {/* The private pulse, beside the review and not a card: a heading, a
            line under it, a row of chips and a note (slice 16i). */}
        <div className="mt-10">
          <div className="h-6 w-48 rounded bg-surface-sunken" />
          <div className="mt-2 h-5 w-full max-w-sm rounded bg-surface-sunken" />
          <div className="mt-4 flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((chip) => (
              <div key={chip} className="h-11 w-24 rounded-lg bg-surface-sunken" />
            ))}
          </div>
          <div className="mt-3 h-20 w-full rounded-lg bg-surface-sunken" />
        </div>
        {/* The quiet doors: hairline rows on the page background, no card. */}
        <div className="mt-10">
          {[0, 1].map((row) => (
            <div key={row} className="border-t border-border py-4 last:border-b">
              <div className="h-6 w-40 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
        {/* One next dive, when the board has one for this diver. */}
        <div className={sectionCardClass({ padding: "none", className: "mt-10 h-40" })} />
      </div>
    </main>
  );
}
