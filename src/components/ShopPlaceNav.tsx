"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { useExitAnimation } from "@/components/useExitAnimation";
import { useMenuDismissal } from "@/components/useMenuDismissal";
import { motionMs } from "@/lib/motion";
import {
  currentStaffPlace,
  isStaffDestinationPage,
  STAFF_DESTINATION_BADGE_TONES,
  type StaffBarPlace,
  type StaffDestination,
  type StaffDestinationGates,
  staffBarPlaces,
  staffDestinationHref,
} from "@/lib/staff-destinations";

/**
 * **What a lit place says about itself**, in one place because the bar has two
 * forms and they may not disagree.
 *
 * A place that is not lit says nothing. A lit one says `"page"` only when its
 * own link opens the page being read — everywhere else it says `"true"`, which
 * is ARIA's "the current item in a set, not otherwise specified"
 * (`isStaffDestinationPage`, and #1938 for what the flat `"page"` told a
 * screen-reader user on `/divers`).
 *
 * The same pair `SegmentedControl` takes as `ariaCurrentValue` and `AgencyTabs`,
 * `FilterChips` and `EditorRail` already spell out. The bar was the one control
 * in the app that had not been asked the question.
 */
function placeAriaCurrent(
  active: boolean,
  pathname: string,
  root: string,
  destination: StaffDestination,
): "page" | "true" | undefined {
  if (!active) return undefined;
  return isStaffDestinationPage(pathname, root, destination) ? "page" : "true";
}

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
            aria-current={placeAriaCurrent(active, pathname, root, destination)}
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

/**
 * **The same three times, folded into the date the phone's bar carries** —
 * ADR 20260919-one-idea, decision I · Tide, slice 23b: "a date, a search and
 * the shop's name". `Tide.dc.html`'s pocket draws exactly that, and in that
 * order: the shop's mark and name at the left, then a calendar and a
 * magnifier at the right edge.
 *
 * It is the fold of `ShopPlaceNav` above, not a second nav — same registry
 * read, same words, same idea of which time is lit — because a bar that said
 * one thing at 1280px and another at 390px would be two products. The pills
 * shrink below `lg` for the reason the tab strip did: the bar is a fixed
 * height and nothing in it may wrap, and three words plus a count is more
 * than a 390px row has left once a shop's name is in it.
 *
 * **The count is a dot here and a number inside.** On the desk bar the number
 * sits against the word "Today", which is what gives it its noun; against a
 * bare calendar it would read as a quantity of calendars. So the button wears
 * the signal — something is held back — and says the whole sentence to a
 * screen reader, while the menu behind it carries the digit on the row whose
 * word explains it.
 */
export function ShopPlaceMenu({
  root,
  gates,
  blocked,
  copy,
  className,
}: {
  root: string;
  gates: StaffDestinationGates;
  /** Divers held back by medical review — see `ShopPlaceNav`'s own note. */
  blocked?: number;
  copy: ShopPlaceNavCopy;
  className?: string;
}) {
  const pathname = usePathname() ?? "";
  const current = currentStaffPlace(pathname, root, gates);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The one dismissal contract every disclosed staff menu shares.
  const close = useCallback(() => setOpen(false), []);
  useMenuDismissal({ open, close, inside: [rootRef], returnFocus: triggerRef });
  // 180ms matches .animate-scale-out in globals.css — the two must move together.
  const { mounted, closing } = useExitAnimation(open, motionMs("base"));
  return (
    <div ref={rootRef} className={`relative flex ${className ?? ""}`}>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        // Named for the nav it opens, and by the same string: two controls
        // that are one nav may not be two words.
        aria-label={copy.navAriaLabel}
        data-place-menu
        className="relative grid size-11 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
      >
        <DiveDayIcon name="board" className="size-5" />
        {blocked ? (
          <>
            {/* Over the mark's own corner rather than beside it, so the bar's
                width does not move when a diver is held back. `border` in the
                bar's colour is what keeps it legible against the icon's
                strokes at 8px. */}
            <span
              aria-hidden="true"
              className="absolute top-1.5 end-1.5 size-2.5 rounded-full border-2 border-background bg-danger"
            />
            <span className="sr-only">{copy.blockedLabel}</span>
          </>
        ) : null}
      </button>
      {mounted ? (
        <nav
          aria-label={copy.navAriaLabel}
          className={`absolute top-full end-0 z-10 mt-2 min-w-40 rounded-inset border border-border bg-surface p-2 shadow-lg ${closing ? "animate-scale-out" : "animate-scale-in"}`}
        >
          {staffBarPlaces(gates).map(({ place, destination }) => {
            const active = place === current;
            return (
              <Link
                key={place}
                href={staffDestinationHref(root, destination)}
                onClick={close}
                aria-current={placeAriaCurrent(active, pathname, root, destination)}
                className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold ${
                  active ? "bg-primary-tint text-primary" : "text-foreground"
                }`}
              >
                {copy.places[place]}
                {destination.badge && blocked ? (
                  <Badge
                    tone={STAFF_DESTINATION_BADGE_TONES[destination.badge]}
                    size="sm"
                    tabularNums
                    toneMark={false}
                    className="ms-auto px-1.5 py-0"
                  >
                    <span aria-hidden="true">{blocked}</span>
                    <span className="sr-only">{copy.blockedLabel}</span>
                  </Badge>
                ) : null}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
