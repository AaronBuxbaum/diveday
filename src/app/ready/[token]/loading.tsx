import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";

/**
 * Body-shaped skeleton for `/ready` (design principle 1) — the token lookup
 * and readiness read have no loading state to show meanwhile, and this is a
 * page divers open on hotel wifi the night before a trip.
 *
 * Shaped like what replaces it, which changed in slice 7c (ADR
 * 20260827-the-divers-thread, decision 3): the header, then the status
 * figure, then the step spine as hairline rows on the page background — no
 * card, because the spine is not one any more. The third row stands tall
 * because one step is open at rest with its form inline, and a skeleton of
 * five equal rows would collapse the instant the real one arrived.
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
        {/* The one status statement: a figure, and what is next. */}
        <div className="mt-8 flex items-baseline gap-3">
          <div className="h-8 w-10 rounded bg-surface-sunken" />
          <div className="h-5 w-24 rounded bg-surface-sunken" />
          <div className="ms-auto h-4 w-32 rounded bg-surface-sunken" />
        </div>
        <div className="mt-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="border-t border-border py-4 last:border-b">
              <div className="flex items-center gap-3">
                <div className="size-5 shrink-0 rounded-full bg-surface-sunken" />
                <div className="h-5 w-40 max-w-full rounded bg-surface-sunken" />
              </div>
              {i === 2 ? <div className="mt-4 h-40 w-full rounded-xl bg-surface-sunken" /> : null}
            </div>
          ))}
        </div>
        {/* What to pack, below the spine. */}
        <div className="mt-10 h-6 w-48 rounded bg-surface-sunken" />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded bg-surface-sunken" />
          ))}
        </div>
      </div>
    </main>
  );
}
