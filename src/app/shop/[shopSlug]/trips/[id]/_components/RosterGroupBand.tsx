import type { ReactNode } from "react";
import { GroupLabel } from "@/components/ui/ledger";

/**
 * A group's top rule: a hairline between groups, and none above the first,
 * where the card's own border already is. `first:` asks about the element's
 * own parent, so the rule belongs to whichever element is the card's child —
 * the band, or the `RosterGroup` box that holds it. The add-diver band once
 * sat first inside a wrapper of its own and lost its rule, the one group band
 * in the card without one (K-354).
 */
const GROUP_RULE = "border-t border-border first:border-t-0";

/** The tinted row: the state word and the count, with the group's quiet facts at its end. */
const BAND =
  "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-surface-sunken/50 px-4 py-2.5 sm:px-5";

/**
 * The tinted band that owns everything the ledger rows beneath it share — the
 * state word and the count, said once for the whole group instead of repeated
 * down every row (ADR 20260827-the-departure-is-two-working-surfaces, slice
 * 5d; design principle 9). The label is a real heading so "Waiting for a seat"
 * stays findable by a screen reader the way the old section headings were.
 *
 * Its rows follow it as siblings in the card. A group that has to be one
 * element — a fragment target a spec or a deep link scopes to, with its body
 * inside — is a `RosterGroup` instead.
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
    <div id={id} className={`${BAND} scroll-mt-24 ${GROUP_RULE}`}>
      <GroupLabel as="h3">{label}</GroupLabel>
      {children}
    </div>
  );
}

/**
 * **A band and its body as one box**, for a group whose fragment target has to
 * hold its body — `#add-diver`, which deep links land on and which scopes the
 * search and the "Add diver" door inside it. The box is the card's child, so
 * it draws the group's rule, and the band inside it draws none.
 */
export function RosterGroup({
  id,
  label,
  children,
}: {
  id: string;
  label: ReactNode;
  /** The group's body, under the band. */
  children: ReactNode;
}) {
  return (
    <div id={id} className={`scroll-mt-24 ${GROUP_RULE}`}>
      <div className={BAND}>
        <GroupLabel as="h3">{label}</GroupLabel>
      </div>
      {children}
    </div>
  );
}
