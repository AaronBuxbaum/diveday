import type { ReactNode } from "react";
import type { StaffMessageKey } from "@/i18n/staff-messages";

/**
 * The diver record's spine.
 *
 * This page is one very long scroll — eleven stacked sections, about 6,400px on
 * a phone — and staff arrive at it with one of two errands: "verify this card"
 * (near the top, fine) or "take this payment" (which used to sit seventh, some
 * 4,500px down, reachable only by flicking). The bar below is the way down.
 *
 * **Anchors, not routes.** The trip surfaces split into four pages because each
 * one answers a different question and loads its own data; a diver record is a
 * single `getDiverProfile` read that every section shares, so splitting it into
 * segments would fork one query into five and make every tab a round trip. A
 * hash link is a same-document jump the browser handles itself: no re-render, no
 * refetch, and it keeps working with JavaScript still on its way. That is also
 * why this is a Server Component with no active-tab state — there is no "current
 * page" to mark, only places to go.
 *
 * The chrome is `TripSubNav`'s so the two read as the same control (see its
 * docstring); the ids and `scroll-mt` follow Settings' groups.
 *
 * **Remove and Erase are deliberately not here.** They are the destructive tail
 * of the page, and a one-tap jump to "erase this diver's personal and medical
 * data" is not a convenience anybody asked for (ADR
 * 20260802-diver-data-erasure). Reaching them costs a scroll, on purpose.
 */
export const DIVER_SECTIONS = [
  { id: "cards", labelKey: "divers.subNav.cards" },
  { id: "fit", labelKey: "divers.subNav.fit" },
  { id: "payments", labelKey: "divers.subNav.payments" },
  { id: "trips", labelKey: "divers.subNav.trips" },
  { id: "history", labelKey: "divers.subNav.history" },
] as const satisfies readonly { id: string; labelKey: StaffMessageKey }[];

export type DiverSectionId = (typeof DIVER_SECTIONS)[number]["id"];

export function DiverSubNav({
  ariaLabel,
  labels,
  className = "",
}: {
  ariaLabel: string;
  /** One label per entry of `DIVER_SECTIONS`, in that order, resolved on the server. */
  labels: readonly string[];
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={`flex snap-x gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-sunken p-1 print:hidden ${className}`}
    >
      {DIVER_SECTIONS.map((section, index) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="inline-flex min-h-11 flex-1 snap-start items-center justify-center rounded-xl px-3 text-sm font-semibold whitespace-nowrap text-muted transition-colors duration-200 hover:bg-surface hover:text-foreground"
        >
          {labels[index]}
        </a>
      ))}
    </nav>
  );
}

/**
 * An anchor target for one bar entry. A wrapper rather than an id on each
 * section's own heading because a group can be more than one section (Cards is
 * level cards *and* specialties; Trips is the booking form *and* the upcoming
 * list) and because `UpcomingTripsSection` renders nothing when the diver has no
 * upcoming trips — an id living inside it would vanish with it and the bar would
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
