"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the post-trip recap page — reviews, tips, and photos. A
 * render error here should offer one clear "Try again," not a raw stack
 * trace on the page that thanks a diver for their trip. Words come from the
 * `errorBoundary` namespace `./layout.tsx` mounts above this boundary (ADR
 * 20260803-error-boundary-copy-bridge).
 */
export default function RecapError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <ErrorPage
      title={t("title")}
      body={t("bodySaved")}
      resetLabel={t("tryAgain")}
      onReset={reset}
    />
  );
}
