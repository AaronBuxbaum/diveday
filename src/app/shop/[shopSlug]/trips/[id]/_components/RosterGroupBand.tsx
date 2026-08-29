import type { ReactNode } from "react";
import { GroupLabel } from "@/components/ui/ledger";

/**
 * The tinted band that owns everything the ledger rows beneath it share — the
 * state word and the count, said once for the whole group instead of repeated
 * down every row (ADR 20260827-the-departure-is-two-working-surfaces, slice
 * 5d; design principle 9). The label is a real heading so "Waiting for a seat"
 * stays findable by a screen reader the way the old section headings were.
 */
export function RosterGroupBand({
  id,
  label,
  children,
}: {
  /** Fragment target for the deep links that used to land on a section. */
  id?: string;
  label: ReactNode;
  /** Right-aligned quiet facts, when the group has one. */
  children?: ReactNode;
}) {
  return (
    <div
      id={id}
      className="flex scroll-mt-24 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-border bg-surface-sunken/50 px-4 py-2.5 first:border-t-0 sm:px-5"
    >
      <GroupLabel as="h3">{label}</GroupLabel>
      {children}
    </div>
  );
}
