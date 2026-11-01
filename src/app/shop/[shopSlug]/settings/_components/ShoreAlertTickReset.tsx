"use client";

import { useEffect, useRef } from "react";

/**
 * **A changed address never inherits the old tick** (H-20261014-stale-roll-call-recipients owner review #1).
 *
 * The consent box is drawn ticked when an address and its consent are on
 * file, and the form posts the address it was drawn for
 * (`shoreAlertConsentFor`). The server refuses a save whose typed address
 * differs from that one, so without this a staffer changing the address has
 * to clear it and save first. With it, editing the address unticks the box and
 * forgets what it was drawn for, so a new tick is a new tick for the new
 * address. The server rule stands either way; this only spares the round trip.
 *
 * Renders nothing: it finds its own form and listens to the address field.
 */
export function ShoreAlertTickReset() {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    const email = form?.querySelector<HTMLInputElement>('input[name="shoreAlertEmail"]');
    const consent = form?.querySelector<HTMLInputElement>('input[name="shoreAlertConsent"]');
    const consentFor = form?.querySelector<HTMLInputElement>('input[name="shoreAlertConsentFor"]');
    if (!email || !consent || !consentFor) return;
    const drawnFor = consentFor.value.trim().toLowerCase();
    if (drawnFor.length === 0) return;
    const onInput = () => {
      if (email.value.trim().toLowerCase() === drawnFor) return;
      consent.checked = false;
      consentFor.value = "";
    };
    email.addEventListener("input", onInput);
    return () => email.removeEventListener("input", onInput);
  }, []);
  return <span ref={anchor} hidden />;
}
