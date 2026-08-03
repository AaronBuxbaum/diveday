"use client";

import { useEffect } from "react";

/**
 * Preselects the device's own zone in a timezone picker that hasn't been
 * answered yet.
 *
 * Every date and time on every DiveDay surface is rendered in `shops.timezone`
 * — the board's day headers, "sailing today", a departure's 08:30 — and the
 * picker that sets it opened on `DEFAULT_TIMEZONE` (US Eastern) for everyone.
 * A shop that clicked past it got a schedule quietly reading in somebody
 * else's zone, which is the kind of wrongness you only notice weeks later when
 * a departure time is hours off. The device already knows the answer, so this
 * asks it.
 *
 * Renders nothing and enhances the page's own native `<select>` rather than
 * wrapping it: `Field` wires the label, the required marker, and
 * `aria-describedby` by cloning a real `<input>`/`<select>`/`<textarea>`, and
 * a component in that slot would silently lose all three.
 *
 * `detect` is false whenever a value has already been chosen — a sign-up form
 * bounced back with `?timezone=`, or a shop's stored zone in Settings — so
 * this can never overwrite an answer someone gave. It runs once: a shop that
 * picks a different zone and then triggers a re-render keeps their pick.
 */
export function DetectTimezone({ selectId, detect }: { selectId: string; detect: boolean }) {
  useEffect(() => {
    if (!detect) return;
    const select = document.getElementById(selectId);
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.dataset.zoneDetected === "true") return;
    select.dataset.zoneDetected = "true";
    let zone: string | undefined;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      // A runtime that can't answer keeps the server-rendered default. There
      // is nothing better to fall back to and nothing worth failing over.
      return;
    }
    if (!zone) return;
    const offered = Array.from(select.options).some((option) => option.value === zone);
    if (offered) select.value = zone;
  }, [selectId, detect]);

  return null;
}
