import { LedgerGroup } from "@/components/ui/ledger";

/**
 * One urgency band of the shop home's work queue — the group label, the count,
 * and the horizon fold — rendered identically by both of the queue's views
 * (`TodayQueue` by urgency, `BlockerGroups` by departure).
 *
 * This shell used to live twice, copy-pasted, with a comment in each file
 * pointing at the other as the reason the two had to match. The two views are
 * one queue read two ways (ADR 20260803-not-ready-is-a-view), so the band a
 * boat sits in must look and behave the same whichever way a staffer is
 * reading — one component is what makes that a fact instead of a discipline.
 *
 * It is now a thin binding over `LedgerGroup` (`src/components/ui/ledger.tsx`),
 * which owns both halves of what this used to spell for itself: the group
 * label's one small-caps spelling, and the app's one disclosure spelling — a
 * native `<details>`, so keyboard and screen-reader semantics come free and a
 * JS failure degrades to the summary still being one tap from its rows. Two
 * things changed with that move, both ADR
 * 20260827-clearwater-surface-language's decision 3: the bordered capsule
 * around the count retires — a count is quiet text, and `Badge` marks only the
 * exceptional state — and the label's tracking joins the app's single value.
 *
 * Folding stays the caller's rule: both views fold "Next 3 days"/"This week"
 * once something more pressing has already rendered in full.
 */
export function UrgencyBand({
  label,
  count,
  folded,
  children,
}: {
  label: string;
  /** Already-worded count for the group's own line ("3 items", "2 departures"). */
  count: string;
  /** A folded band renders closed, label and count only. */
  folded: boolean;
  children: React.ReactNode;
}) {
  // `undefined`, not `false`: an unfolded band is a plain group rather than an
  // open `<details>`, so a band that never collapses offers no control to press.
  return (
    <LedgerGroup as="h3" label={label} meta={count} folded={folded || undefined}>
      {children}
    </LedgerGroup>
  );
}
