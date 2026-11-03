"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * **One backstop for every page a link opens** (claim, confirm-contact, invite,
 * ready, reset-password, unsubscribe, verify): a render error offers one clear
 * "Try again," not a raw stack trace on a link the visitor can't easily get
 * back to. `recap/[token]` and `waivers/[token]` keep their own boundary only
 * because their sentence says what was *saved*, not what was *done*. Words come
 * from the `errorBoundary` namespace `./layout.tsx` mounts above this boundary
 * (ADR 20260803-error-boundary-copy-bridge).
 */
export default function TokenError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
