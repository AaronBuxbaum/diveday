import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for `/shelf` — the shape the page replaces it with, in
 * the thread's own measure so a navigation into the segment never jumps
 * sideways.
 *
 * Top to bottom: the shell's eyebrow and title, the two or three cards that
 * are the reason to come back, the rail of past days, and the file's card.
 * Never a spinner (`.claude/rules/surfaces.md`).
 */
export default function ShelfLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-56 max-w-full rounded bg-surface-sunken" />

        <div className="mt-8 space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className={sectionCardClass()}>
              <div className="h-5 w-40 max-w-full rounded bg-surface-sunken" />
              <div className="mt-3 h-6 w-56 max-w-full rounded bg-surface-sunken" />
              <div className="mt-2 h-4 w-32 rounded bg-surface-sunken" />
              <div className="mt-4 h-11 w-36 rounded-lg bg-surface-sunken" />
            </div>
          ))}
        </div>

        {/* The rail of days behind. */}
        <div className="mt-10 h-5 w-48 rounded bg-surface-sunken" />
        <div className="mt-4 flex gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 w-56 shrink-0 rounded-lg bg-surface-sunken" />
          ))}
        </div>

        {/* The file. */}
        <div className={`mt-10 ${sectionCardClass()}`}>
          <div className="h-5 w-24 rounded bg-surface-sunken" />
          <div className="mt-4 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-5 w-full rounded bg-surface-sunken" />
            ))}
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded bg-surface-sunken" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
