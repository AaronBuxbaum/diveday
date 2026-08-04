"use client";

import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/button";

/**
 * A backstop for the waiver-signing page — the surface a diver opens from a
 * text message the night before a trip. A render error here should offer one
 * clear "Try again," not a raw stack trace on a page they can't get back to
 * easily.
 *
 * Its words come from the diver bundle through the `errorBoundary` namespace
 * that `./layout.tsx` mounts above this boundary — read that file before
 * touching either, and never render this without a provider above it (ADR
 * 20260803-error-boundary-copy-bridge).
 */
export default function WaiverError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-3 text-muted">{t("bodySaved")}</p>
      <button type="button" onClick={reset} className={buttonClass({ className: "mt-6" })}>
        {t("tryAgain")}
      </button>
    </main>
  );
}
