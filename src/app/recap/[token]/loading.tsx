import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for `/recap` (design principle 1), shaped like the
 * thread's after-state that replaces it (ADR 20260827-the-divers-thread,
 * decision 4): the coral greeting, the dive record, the crew's word, the one
 * review ask, and the run of quiet doors.
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
        {/* The quiet doors: hairline rows on the page background, no card. */}
        <div className="mt-10">
          {[0, 1].map((row) => (
            <div key={row} className="border-t border-border py-4 last:border-b">
              <div className="h-6 w-40 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
