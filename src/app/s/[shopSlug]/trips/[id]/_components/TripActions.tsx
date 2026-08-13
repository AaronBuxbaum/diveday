"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { copyToClipboard } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";

export function TripActions({ calendarUrl }: { calendarUrl: string }) {
  const t = useTranslations("trip");
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function shareTrip() {
    const data = {
      title: document.title,
      text: t("shareText"),
      url: window.location.href,
    };
    if (navigator.share) {
      await navigator.share(data).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      });
      return;
    }
    // Reuses Copyable's own clipboard write (src/components/Copyable.tsx) —
    // this button isn't Copyable-shaped (it shares a `buttonClass` row with
    // "Add to calendar" and only falls back to a copy when the Web Share API
    // is unavailable), but the write itself is never hand-rolled here.
    const ok = await copyToClipboard(window.location.href);
    setStatus(ok ? "copied" : "failed");
    setTimeout(() => setStatus("idle"), 4000);
  }

  const label =
    status === "copied"
      ? t("linkCopied")
      : status === "failed"
        ? t("linkCopyFailed")
        : t("shareWithBuddy");
  const announcement =
    status === "copied"
      ? t("linkCopiedAnnouncement")
      : status === "failed"
        ? t("linkCopyFailed")
        : "";

  return (
    <fieldset className="mt-5 flex flex-wrap gap-2">
      <legend className="sr-only">{t("planAndShare")}</legend>
      <a href={calendarUrl} className={buttonClass({ variant: "secondary", size: "sm" })}>
        {t("addToCalendar")}
      </a>
      {/* No "Get directions" here. The trip page already carries the site's
          own map and its link out (`DiveSiteMap`), and a *second* door to the
          same maps app — sitting in the plan-and-share row, before a diver has
          booked anything — was a third button competing with the one that
          matters on this page. Removed 2026-08-13 at the product owner's call. */}
      <button
        type="button"
        onClick={shareTrip}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {label}
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </fieldset>
  );
}
