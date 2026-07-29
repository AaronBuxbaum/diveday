"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

export function TripActions({
  calendarUrl,
  directionsUrl,
}: {
  calendarUrl: string;
  directionsUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function shareTrip() {
    const data = {
      title: document.title,
      text: "Dive with me — here are the trip details.",
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
      <legend className="sr-only">Plan and share this trip</legend>
      <a href={calendarUrl} className={buttonClass({ variant: "secondary", size: "sm" })}>
        Add to calendar
      </a>
      {directionsUrl ? (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          Get directions
        </a>
      ) : null}
      <button
        type="button"
        onClick={shareTrip}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {copied ? "Link copied" : "Share with a buddy"}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Trip link copied to clipboard." : ""}
      </span>
    </fieldset>
  );
}
