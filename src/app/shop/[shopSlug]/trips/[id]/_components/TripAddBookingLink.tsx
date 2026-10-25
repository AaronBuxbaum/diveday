// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { ADD_A_BOOKING_ID } from "./add-a-booking-id";

/**
 * A masthead door that points at the "Add a booking" band at the roster's
 * foot.
 *
 * **Link weight, not primary.** One act, two primaries: this jump and the
 * band's own "Add diver" submit were both solid, 1,200px apart on desktop and
 * one scroll apart on a phone, so the page offered a staffer a choice between
 * two spellings of the same thing (docs/design/principles.md §8, and
 * forms-and-controls.md's "Action rows"). The band is where the act actually
 * happens, so the band keeps the primary and this is a way down the page.
 *
 * **It says its whole name at every width and lands in the search** (visual
 * review 2026-10-24, A31). At 390 it read "Add", which named nothing; and the
 * jump scrolled to the band but left the cursor up here, so the next tap was
 * a second one into the box. The anchor still scrolls on its own (no script,
 * or a modified click into a new tab); with script, the band's first field
 * takes focus once the page has moved.
 */
export function TripAddBookingLink({
  href,
  label,
  ariaLabel,
}: {
  href: string;
  label: string;
  /** Distinguishes the masthead jump from the inline add form for assistive tech. */
  ariaLabel?: string;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const foot = document.getElementById(ADD_A_BOOKING_ID);
        const field = foot?.querySelector<HTMLElement>("input, select, textarea, button");
        if (!foot || !field) return;
        event.preventDefault();
        history.replaceState(null, "", `#${ADD_A_BOOKING_ID}`);
        foot.scrollIntoView({ block: "start" });
        field.focus({ preventScroll: true });
      }}
      className={buttonClass({ variant: "link", className: "gap-1.5 print:hidden" })}
    >
      <DiveDayIcon name="addBooking" className="size-4" />
      {label}
    </a>
  );
}
