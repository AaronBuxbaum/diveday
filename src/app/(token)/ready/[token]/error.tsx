"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the readiness page — the "what's left before you sail" page
 * a diver opens the night before or the morning of a trip. A render error
 * here should offer one clear "Try again," not a raw stack trace. Words come
 * from the `errorBoundary` namespace `./layout.tsx` mounts above this
 * boundary (ADR 20260803-error-boundary-copy-bridge).
 */
export default function ReadyError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
