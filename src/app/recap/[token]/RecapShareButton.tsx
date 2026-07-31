"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * Makes the recap link itself shareable (task 59 — `recap-links.ts` already
 * calls it that; the page had no affordance for it). Same
 * share-then-clipboard-fallback shape as the trip page's `TripActions`, with
 * the recap's own title/text so a diver can hand the whole recap — sites,
 * shoutout, photos — to whoever they dived with.
 */
export function RecapShareButton({
  shareTitle,
  shareText,
  label,
  copiedLabel,
  copiedAnnouncement,
}: {
  shareTitle: string;
  shareText: string;
  label: string;
  copiedLabel: string;
  copiedAnnouncement: string;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const data = { title: shareTitle, text: shareText, url: window.location.href };
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
    <>
      <button
        type="button"
        onClick={share}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {copied ? copiedLabel : label}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? copiedAnnouncement : ""}
      </span>
    </>
  );
}
