"use client";

import { useState } from "react";
import { copyToClipboard } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";

/**
 * The one review ask left after a strong on-page rating (task 57 — merges
 * what used to be two stacked asks into one). Copies the diver's own words
 * to the clipboard (nothing to copy for a bare rating) and sends them on to
 * the shop's own review link, so pasting into Google/TripAdvisor takes one
 * more click instead of retyping what they already wrote here. This is a
 * link, not a `Copyable`-shaped button, so it keeps its own markup — but the
 * write itself goes through Copyable's shared `copyToClipboard`, same as
 * every other copy control.
 */
export function ShareReviewButton({
  reviewUrl,
  comment,
  cta,
  copiedLabel,
  className = "",
}: {
  reviewUrl: string;
  comment: string | null;
  cta: string;
  copiedLabel: string;
  /**
   * The door's own geometry. Slice 7d moved this control out of a block of
   * its own and into the after-state's run of quiet doors, where the margin
   * it used to bake in belongs to the row rather than to the button.
   */
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleClick() {
    if (!comment) return;
    // A denied or unsupported clipboard is not worth an error state here:
    // the link still opens either way, and the diver's words were only ever
    // a convenience on top of it.
    copyToClipboard(comment).then((ok) => {
      if (ok) setCopied(true);
    });
  }

  return (
    <a
      href={reviewUrl}
      target="_blank"
      rel="noopener"
      onClick={handleClick}
      className={buttonClass({ size: "cta", className })}
    >
      {copied ? copiedLabel : cta}
    </a>
  );
}
