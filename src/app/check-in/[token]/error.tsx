"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ErrorPage } from "@/components/ErrorPage";

/** Long enough that a diver mid-tap is not interrupted, short enough that the counter comes back on its own. */
const RETRY_MS = 60_000;

/**
 * A backstop for the counter tablet — a screen a shop leaves running in the
 * lobby all day, with nobody standing next to it.
 *
 * **The retry lives here, because this is what survives the failure.** One
 * transient throw at 07:14 would otherwise leave a "Try again" card on the
 * glass until somebody noticed, which on a self-service surface is until a
 * diver asks a staffer why the tablet is broken. `reset()` remounts the page;
 * this is the timer that calls it. Same shape and same reason as the departures
 * board's boundary.
 *
 * Words come from the `errorBoundary` namespace `./layout.tsx` mounts above
 * this boundary (ADR 20260803-error-boundary-copy-bridge).
 */
export default function KioskCheckInError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  useEffect(() => {
    const timer = setInterval(reset, RETRY_MS);
    return () => clearInterval(timer);
  }, [reset]);
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
