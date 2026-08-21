"use client";

import { useEffect } from "react";
import { saveReturningDiver } from "@/lib/returning-diver";

/**
 * Renders nothing — on mount, remembers who just booked so the next visit
 * from this device can prefill the lead diver's name/email (task 27, the
 * Marco persona). A `useEffect` rather than a server-side write: this is a
 * per-device convenience, not account data, and it must never fire twice for
 * one booking on a client-side back/forward navigation that re-shows this
 * same confirmation without a fresh submit.
 *
 * Mounted on `/ready` under `?booked=1` — the moment a seat was just taken —
 * rather than in the trip page's `_components/`, where it lived while the
 * confirmation was a branch of that page (ADR 20260820-one-page-after-booking).
 * `?booked=1` and not every `/ready` visit, because "who just booked from this
 * device" is the fact it records: a reminder link opened on a shared tablet
 * three days later is not that.
 */
export function RememberBooker({ fullName, email }: { fullName: string; email: string }) {
  useEffect(() => {
    saveReturningDiver({ fullName, email });
  }, [fullName, email]);
  return null;
}
