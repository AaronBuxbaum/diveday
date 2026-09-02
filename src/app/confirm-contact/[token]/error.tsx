"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the contact-confirmation link — a one-tap page opened
 * straight from an inbox, the same shape as `/verify/[token]`. Words come
 * from the `errorBoundary` namespace `./layout.tsx` mounts above this
 * boundary (ADR 20260803-error-boundary-copy-bridge).
 */
export default function ConfirmContactError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
