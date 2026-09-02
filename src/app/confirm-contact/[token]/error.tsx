"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the contact-address confirmation link — like the verification
 * page it mirrors, a one-tap page opened straight from an inbox, which the
 * reader cannot easily get back to. A render error offers one clear "Try
 * again", never a stack trace. Words come from the `errorBoundary` namespace
 * `./layout.tsx` mounts above this boundary.
 */
export default function ConfirmContactError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
