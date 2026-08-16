import type { ReactNode } from "react";
import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The diver record's spine.
 *
 * This page is one very long scroll — twelve stacked sections, about 6,400px on
 * a phone — and staff arrive at it with one of two errands: "verify this card"
 * (near the top, fine) or "take this payment" (which used to sit seventh, some
 * 4,500px down, reachable only by flicking). The row of anchors the page builds
 * from this list is the way down; the row itself is `JumpNav`, shared with
 * Settings, and its docstring explains why it deliberately does *not* look like
 * `TripSubNav`'s tab bar.
 *
 * The `id`s and `scroll-mt` follow Settings' groups.
 *
 * **Remove and Erase are deliberately not here.** They are the destructive tail
 * of the page, and a one-tap jump to "erase this diver's personal and medical
 * data" is not a convenience anybody asked for (ADR
 * 20260802-diver-data-erasure). Reaching them costs a scroll, on purpose.
 */
export const DIVER_SECTIONS = [
  { id: "cards", labelKey: "divers.subNav.cards" },
  { id: "notes", labelKey: "divers.subNav.notes" },
  { id: "fit", labelKey: "divers.subNav.fit" },
  { id: "payments", labelKey: "divers.subNav.payments" },
  { id: "trips", labelKey: "divers.subNav.trips" },
  { id: "history", labelKey: "divers.subNav.history" },
] as const satisfies readonly { id: string; labelKey: StaffMessageKey }[];

export type DiverSectionId = (typeof DIVER_SECTIONS)[number]["id"];

/**
 * An anchor target for one row entry. A wrapper rather than an id on each
 * section's own heading because a group can be more than one section (Cards is
 * level cards *and* specialties; Trips is the booking form *and* the upcoming
 * list) and because `UpcomingTripsSection` renders nothing when the diver has no
 * upcoming trips — an id living inside it would vanish with it and the row would
 * link to nowhere.
 *
 * The wrapper adds no box of its own, so the child's top margin collapses
 * through it and the page's spacing is unchanged.
 */
export function DiverSection({ id, children }: { id: DiverSectionId; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      {children}
    </div>
  );
}
