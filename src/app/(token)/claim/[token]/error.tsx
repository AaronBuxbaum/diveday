"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the seat-claim page — the link a party member opens to make
 * a held seat their own. A render error here should offer one clear "Try
 * again," not a raw stack trace. Words come from the `errorBoundary`
 * namespace `./layout.tsx` mounts above this boundary (ADR
 * 20260803-error-boundary-copy-bridge).
 */
export default function ClaimError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
