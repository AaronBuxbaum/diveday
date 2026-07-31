"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * The one review ask left after a strong on-page rating (task 57 — merges
 * what used to be two stacked asks into one). Copies the diver's own words
 * to the clipboard (nothing to copy for a bare rating) and sends them on to
 * the shop's own review link, so pasting into Google/TripAdvisor takes one
 * more click instead of retyping what they already wrote here.
 */
export function ShareReviewButton({
  reviewUrl,
  comment,
  cta,
  copiedLabel,
}: {
  reviewUrl: string;
  comment: string | null;
  cta: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleClick() {
    if (!comment) return;
    navigator.clipboard.writeText(comment).then(
      () => setCopied(true),
      () => {}, // clipboard permission denied or unavailable — the link still opens
    );
  }

  return (
    <a
      href={reviewUrl}
      target="_blank"
      rel="noopener"
      onClick={handleClick}
      className={buttonClass({ size: "cta", className: "mt-4" })}
    >
      {copied ? copiedLabel : cta}
    </a>
  );
}
