"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

export function TripActions({
  calendarUrl,
  directionsUrl,
}: {
  calendarUrl: string;
  directionsUrl: string | null;
}) {
  const t = useTranslations("trip");
  const [copied, setCopied] = useState(false);

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
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
  }

  return (
    <fieldset className="mt-5 flex flex-wrap gap-2">
      <legend className="sr-only">{t("planAndShare")}</legend>
      <a href={calendarUrl} className={buttonClass({ variant: "secondary", size: "sm" })}>
        {t("addToCalendar")}
      </a>
      {directionsUrl ? (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("getDirections")}
        </a>
      ) : null}
      <button
        type="button"
        onClick={shareTrip}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {copied ? t("linkCopied") : t("shareWithBuddy")}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? t("linkCopiedAnnouncement") : ""}
      </span>
    </fieldset>
  );
}
