"use client";

import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/button";

/**
 * The diver-side backstop. These pages inherited `/shop/[shopSlug]/error.tsx`
 * before the public surfaces moved into their own namespace (ADR
 * 20260803-public-shop-namespace); without a boundary of their own a render
 * error on a booking page would escalate to `global-error.tsx` and replace the
 * whole document. A diver mid-booking gets one obvious "Try again" instead.
 *
 * Its words arrive through the `errorBoundary` namespace mounted by
 * `s/[shopSlug]/layout.tsx` — a boundary is a file convention with a fixed
 * `{error, reset}` signature, so context is the only channel a Server
 * Component has to reach it (ADR 20260803-error-boundary-copy-bridge).
 */
export default function PublicShopError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-3 text-muted">{t("bodyBooked")}</p>
      <button
        type="button"
        onClick={reset}
        className={buttonClass({ size: "cta", className: "mt-6" })}
      >
        {t("tryAgain")}
      </button>
    </main>
  );
}
