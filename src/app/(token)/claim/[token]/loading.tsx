import { SkeletonLineBars } from "@/components/ShopPageHeader";
import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";

/**
 * Body-shaped skeleton for /claim (design principle 1) — the token lookup has
 * no loading state of its own to show, and this page is opened from a chat
 * message on a phone more often than anywhere else.
 *
 * `ThreadShell`'s header as bars — the eyebrow's 16px, the `text-3xl` title's
 * 36px lines, the date line's 24px `mt-1` under it — then the one
 * `SectionCard` the page works in, `mt-8` below. "A seat on … is waiting for
 * you" wraps to three lines in a phone's 350px and two in the column's 528,
 * so the card lands at y 224 and 204, where the skeleton's stands (K-224: it
 * drew two panels, the first at 132).
 */
export default function ClaimLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2">
          <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-9" width="w-full max-w-md" />
        </div>
        <div className="mt-1 h-6 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8 h-64 rounded-panel border border-border bg-surface shadow-bed" />
      </div>
    </main>
  );
}
