"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  currentStaffPlace,
  STAFF_DESTINATION_BADGE_TONES,
  type StaffBarPlace,
  type StaffDestinationGates,
  staffBarPlaces,
  staffDestinationHref,
} from "@/lib/staff-destinations";

/**
 * **The three times the bar wears** — ADR 20260919-one-idea, decision I · Tide,
 * slice 23b: "A date, a search and the shop's name in the bar — no tabs, no
 * More, no dock."
 *
 * What left was a nav of *nouns*: five tabs always on screen, a "More" menu
 * from `lg` up and a bottom sheet rising from a phone dock's sixth slot, all
 * three deriving twenty-one destinations from the same registry. What stands
 * is Today, Week and Season — the same three the desk bar is drawn with on
 * `Tide.dc.html`.
 *
 * It is not a smaller nav of nouns. A place is a *time*, so the pages behind
 * these three may be rebuilt without the bar changing: the board becomes the
 * week in 23f and the season grows in 23g, and Week and Season keep pointing
 * at them. Everything that is not one of the three is reached through the day
 * it sits on, or through the search beside this — which is a control at every
 * width, never a keyboard shortcut (ADR 20260813-more-is-the-shops-other-door
 * retired an earlier bar for making fourteen destinations ⌘K-only, and that
 * finding still stands).
 *
 * A staff component takes its words as props; `staffTranslator` is
 * server-side only.
 */
export type ShopPlaceNavCopy = {
  navAriaLabel: string;
  /** "Today", "Week", "Season", already worded and in the reader's language. */
  places: Record<StaffBarPlace, string>;
  /** The blocked count's noun, already pluralised for the number it carries. */
  blockedLabel: string;
};

const placeClass =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap transition-colors";

export function ShopPlaceNav({
  root,
  gates,
  blocked,
  copy,
  className,
}: {
  root: string;
  gates: StaffDestinationGates;
  /**
   * Divers held back by medical review, drawn on Today.
   *
   * **It followed the tab rather than leaving with it.** Every other count in
   * this app lives on the page that ranks the work — reviews, stuck payments,
   * unanswered messages all signal from Today's own queue and never from a nav
   * row, and the registry says so. This one is the exception it already was:
   * a blocked diver is somebody a shop may not board, the number is read from
   * wherever a staffer happens to be standing, and a bar that dropped it would
   * be quieter about the one thing here that is about safety.
   */
  blocked?: number;
  copy: ShopPlaceNavCopy;
  className?: string;
}) {
  const pathname = usePathname() ?? "";
  // One answer for the whole bar, from the registry: the destination whose
  // claim on this path is longest decides which time is lit, so a departure
  // under /trips lights Week (the board claims it) and the gear register
  // lights nothing at all — it lives behind the shop's name.
  const current = currentStaffPlace(pathname, root, gates);
  return (
    <nav aria-label={copy.navAriaLabel} className={`flex min-w-0 items-center gap-1 ${className}`}>
      {staffBarPlaces(gates).map(({ place, destination }) => {
        const active = place === current;
        return (
          <Link
            key={place}
            href={staffDestinationHref(root, destination)}
            aria-current={active ? "page" : undefined}
            className={`${placeClass} ${
              active ? "bg-primary-tint text-primary" : "text-muted hover:text-foreground"
            }`}
          >
            {copy.places[place]}
            {destination.badge && blocked ? (
              <Badge
                tone={STAFF_DESTINATION_BADGE_TONES[destination.badge]}
                size="sm"
                tabularNums
                // A count, not a status: the tone and the digit say it, and the
                // mark's width is what used to push this row ragged.
                toneMark={false}
                className="ms-1.5 px-1.5 py-0"
              >
                <span aria-hidden="true">{blocked}</span>
                <span className="sr-only">{copy.blockedLabel}</span>
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
