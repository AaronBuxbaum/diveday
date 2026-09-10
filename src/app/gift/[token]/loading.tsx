import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";

/**
 * Body-shaped skeleton for the giver's page (design principle 1) — the token
 * verify and the four-row read have no loading state of their own to show, and
 * this page is opened from an email on a phone more often than anywhere else.
 */
export default function GiftLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-6 h-56 rounded-panel border border-border bg-surface shadow-bed" />
      </div>
    </main>
  );
}
