import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";

/**
 * Body-shaped skeleton for /claim (design principle 1) — the token lookup has
 * no loading state of its own to show, and this page is opened from a chat
 * message on a phone more often than anywhere else.
 */
export default function ClaimLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-28 rounded-panel border border-border bg-surface shadow-bed" />
        <div className="mt-6 h-64 rounded-panel border border-border bg-surface shadow-bed" />
      </div>
    </main>
  );
}
