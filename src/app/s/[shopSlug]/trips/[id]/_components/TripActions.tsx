"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { copyToClipboard } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";

export function TripActions({
  calendarUrl,
  directionsUrl,
}: {
  calendarUrl: string;
  directionsUrl: string | null;
}) {
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
    // "Add to calendar"/"Get directions" and only falls back to a copy when
    // the Web Share API is unavailable), but the write itself is never
    // hand-rolled here.
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
    // Ghost weight, not three bordered pills: these are conveniences, and a
    // row of same-weight boxed buttons right under the masthead outshouted
    // the price above and the booking card below (design/principles.md #8 —
    // nothing here competes with the one primary action).
    <fieldset className="mt-4 -ml-3 flex flex-wrap gap-1">
      <legend className="sr-only">{t("planAndShare")}</legend>
      <a href={calendarUrl} className={buttonClass({ variant: "ghost", size: "sm" })}>
        {t("addToCalendar")}
      </a>
      {directionsUrl ? (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {t("getDirections")}
        </a>
      ) : null}
      <button
        type="button"
        onClick={shareTrip}
        className={buttonClass({ variant: "ghost", size: "sm" })}
      >
        {label}
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </fieldset>
  );
}
