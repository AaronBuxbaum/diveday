"use client";

import { useState } from "react";
import { copyToClipboard } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";

/**
 * Makes the recap link itself shareable (task 59 — `recap-links.ts` already
 * calls it that; the page had no affordance for it). Same
 * share-then-clipboard-fallback shape as the trip page's `TripActions`, with
 * the recap's own title/text so a diver can hand the whole recap — sites,
 * shoutout, photos — to whoever they dived with. The clipboard write itself
 * goes through Copyable's shared `copyToClipboard` rather than being
 * hand-rolled here — this button isn't `Copyable`-shaped (it only falls back
 * to a copy when the Web Share API is unavailable), so it keeps its own
 * markup, but never its own clipboard call.
 */
export function RecapShareButton({
  shareTitle,
  shareText,
  label,
  copiedLabel,
  copiedAnnouncement,
  failedLabel,
}: {
  shareTitle: string;
  shareText: string;
  label: string;
  copiedLabel: string;
  copiedAnnouncement: string;
  failedLabel: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    const data = { title: shareTitle, text: shareText, url: window.location.href };
    if (navigator.share) {
      await navigator.share(data).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      });
      return;
    }
    const ok = await copyToClipboard(window.location.href);
    setStatus(ok ? "copied" : "failed");
    setTimeout(() => setStatus("idle"), 4000);
  }

  const buttonText = status === "copied" ? copiedLabel : status === "failed" ? failedLabel : label;

  return (
    <>
      <button
        type="button"
        onClick={share}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {buttonText}
      </button>
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? copiedAnnouncement : status === "failed" ? failedLabel : ""}
      </span>
    </>
  );
}
