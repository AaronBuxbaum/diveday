import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { ReadyThreadBodySkeleton } from "./_components/ReadyThreadBodySkeleton";

/**
 * Body-shaped skeleton for `/ready` (design principle 1) — the token lookup
 * and readiness read have no loading state to show meanwhile, and this is a
 * page divers open on hotel wifi the night before a trip.
 *
 * Shaped like what replaces it, which changed in slice 7c (ADR
 * 20260827-the-divers-thread, decision 3): the header, then the thread under
 * it. The thread's bars are `ReadyThreadBodySkeleton`, which the page itself
 * also stands in while the spine's reads stream in under a confirmation that
 * has already painted (UX audit #5).
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
      </div>
      <ReadyThreadBodySkeleton />
    </main>
  );
}
