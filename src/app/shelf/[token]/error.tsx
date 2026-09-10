"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the diver's shelf — the standing page a diver opens on their
 * phone to see what their shop holds for them. A render error here offers one
 * clear "Try again", never a raw stack trace: this URL *is* the capability, and
 * a stack trace on a bearer page is both alarming and a disclosure.
 *
 * `bodySaved` rather than `bodyDone`: the two things a diver does here are
 * saving their sizes and their emergency contact, so what they want to know
 * after a failure is whether the save survived.
 *
 * Words come from the `errorBoundary` namespace `./layout.tsx` mounts above
 * this boundary (ADR 20260803-error-boundary-copy-bridge).
 */
export default function ShelfError({ reset }: { error: Error; reset: () => void }) {
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
