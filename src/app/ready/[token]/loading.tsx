import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for /ready (design principle 1) — the token lookup and
 * readiness summary have no loading state to show meanwhile, and this is a
 * page divers often open on hotel wifi the night before a trip. Shaped like
 * the page it stands in for: a short eyebrow, the trip title, three meta lines,
 * then the one spine card — a header block with its progress bar over the
 * divided checklist rows, the last of which is the gear row and stands as tall
 * as the rental form it opens with.
 */
export default function ReadyLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-5 w-56 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-full max-w-sm rounded bg-surface-sunken" />
        {/* The card's shell comes from the same place the page's own cards do,
            so the skeleton cannot drift from what replaces it. */}
        <div className={sectionCardClass({ padding: "none", className: "mt-8 overflow-hidden" })}>
          <div className="p-5 sm:p-6">
            <div className="h-6 w-48 rounded bg-surface-sunken" />
            <div className="mt-3 h-5 w-full rounded bg-surface-sunken" />
            <div className="mt-4 h-3 w-full rounded-full bg-surface-sunken" />
          </div>
          <div className="divide-y divide-border border-t border-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-4 px-4 py-4 sm:px-5">
                <div className="size-10 shrink-0 rounded-xl bg-surface-sunken" />
                <div className="min-w-0 flex-1">
                  <div className="h-5 w-40 max-w-full rounded bg-surface-sunken" />
                  <div className="mt-2 h-4 w-full rounded bg-surface-sunken" />
                  {/* The gear row carries the rental form as its action, so it
                      is several times the height of the rows above it — a
                      skeleton that ended in four equal rows would collapse the
                      moment the real one arrived. */}
                  {i === 3 ? (
                    <div className="mt-3 h-40 w-full rounded-xl bg-surface-sunken" />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
