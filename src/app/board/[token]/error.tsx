"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ErrorPage } from "@/components/ErrorPage";

/** The same minute the board itself refreshes on. */
const RETRY_MS = 60_000;

/**
 * A backstop for the departures board — the screen a shop leaves running in
 * the lobby all day.
 *
 * **The retry lives here, because this is the only thing that survives the
 * failure.** `BoardRefresh` is rendered by the page, so a tripped boundary
 * unmounts it and takes its interval with it; and `router.refresh()` would not
 * clear the boundary anyway. `reset()` is what remounts the page. Without this
 * timer, one transient throw at 07:14 — a database blip inside the token
 * check, anything in `getDeparturesBoard` — left a "Try again" card on the TV
 * with nobody standing next to it, and it was still there at closing.
 *
 * Words come from the `errorBoundary` namespace `./layout.tsx` mounts above
 * this boundary (ADR 20260803-error-boundary-copy-bridge).
 */
export default function BoardError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  useEffect(() => {
    const timer = setInterval(reset, RETRY_MS);
    return () => clearInterval(timer);
  }, [reset]);
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
