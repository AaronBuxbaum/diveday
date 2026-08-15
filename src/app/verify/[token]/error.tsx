"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the email-verification link — a one-tap page opened straight
 * from an inbox. A render error here should offer one clear "Try again," not
 * a raw stack trace on a link the visitor can't easily get back to. Words
 * come from the `errorBoundary` namespace `./layout.tsx` mounts above this
 * boundary (ADR 20260803-error-boundary-copy-bridge).
 */
export default function VerifyError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
