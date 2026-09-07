"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the departures board — the screen a shop leaves running in
 * the lobby all day. Nobody is standing at this one to read a stack trace, so
 * a render error becomes the app's ordinary "Try again" card and the next
 * minute's refresh gets another go. Words come from the `errorBoundary`
 * namespace `./layout.tsx` mounts above this boundary (ADR
 * 20260803-error-boundary-copy-bridge).
 */
export default function BoardError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
