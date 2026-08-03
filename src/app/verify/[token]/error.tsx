"use client";

import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/button";

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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-3 text-muted">{t("bodyDone")}</p>
      <button type="button" onClick={reset} className={buttonClass({ className: "mt-6" })}>
        {t("tryAgain")}
      </button>
    </main>
  );
}
