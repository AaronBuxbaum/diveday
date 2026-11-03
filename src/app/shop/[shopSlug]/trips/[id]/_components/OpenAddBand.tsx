"use client";

import { useEffect } from "react";
import { ADD_A_BOOKING_ID } from "./add-a-booking-id";

/**
 * **`?add=1` lands in the add band** (#2737): every "Add a booking" door that
 * knows the departure opens it on this page, and the staffer's next keystroke
 * belongs in the band's first field, not at the top of the roster. The band
 * renders on the server either way; this only scrolls to it and focuses it,
 * the same move the masthead's `TripAddBookingLink` makes on a tap.
 */
export function OpenAddBand() {
  useEffect(() => {
    const band = document.getElementById(ADD_A_BOOKING_ID);
    const field = band?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
    if (!band) return;
    band.scrollIntoView({ block: "start" });
    field?.focus({ preventScroll: true });
  }, []);
  return null;
}
