"use client";

import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/button";

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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-3 text-muted">{t("bodyDone")}</p>
      <button type="button" onClick={reset} className={buttonClass({ className: "mt-6" })}>
        {t("tryAgain")}
      </button>
    </main>
  );
}
