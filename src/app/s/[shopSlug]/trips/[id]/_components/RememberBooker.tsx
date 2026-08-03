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
 */
export function RememberBooker({ fullName, email }: { fullName: string; email: string }) {
  useEffect(() => {
    saveReturningDiver({ fullName, email });
  }, [fullName, email]);
  return null;
}
