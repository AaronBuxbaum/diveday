import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/**
 * One urgency band of the shop home's work queue — the uppercase heading, the
 * count pill, and the horizon fold — rendered identically by both of the
 * queue's views (`TodayQueue` by urgency, `BlockerGroups` by departure).
 *
 * This shell used to live twice, copy-pasted, with a comment in each file
 * pointing at the other as the reason the two had to match. The two views are
 * one queue read two ways (ADR 20260803-not-ready-is-a-view), so the band a
 * boat sits in must look and behave the same whichever way a staffer is
 * reading — one component is what makes that a fact instead of a discipline.
 *
 * Folding is the caller's rule (both views fold "Next 3 days"/"This week"
 * once something more pressing already rendered in full); this component only
 * owns what a fold *is*: a native `<details>` closed to heading and count, so
 * keyboard and screen-reader semantics come free and a JS failure degrades to
 * the summary still being one tap from its rows.
 */
export function UrgencyBand({
  label,
  count,
  folded,
  children,
}: {
  label: string;
  /** Already-worded count for the header pill ("3 items", "2 departures"). */
  count: string;
  /** A folded band renders closed, heading and count only. */
  folded: boolean;
  children: React.ReactNode;
}) {
  const header = (
    <div className="flex w-full items-baseline justify-between gap-3">
      <h3 className="text-xs font-bold tracking-[0.18em] text-muted uppercase">{label}</h3>
      <span className="rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted tabular-nums">
        {count}
      </span>
    </div>
  );
  if (!folded) {
    return (
      <div>
        {header}
        {children}
      </div>
    );
  }
  return (
    <details className="group/fold">
      <summary className="-mx-2 flex cursor-pointer list-none items-baseline gap-2 rounded-lg px-2 py-1 transition-colors select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken">
        {/* Which way this goes, before you press it — decorative, the native
            disclosure semantics carry the state. */}
        <DisclosureCaret className="self-center text-muted group-open/fold:rotate-90" />
        {header}
      </summary>
      {children}
    </details>
  );
}
