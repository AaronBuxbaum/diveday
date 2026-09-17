"use client";

import { useState } from "react";
import { copyToClipboard } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";

/**
 * A constant rather than `useId`: React 19 mints ids containing `«»`, which
 * `document.getElementById` accepts and a CSS selector does not — and this
 * element is how `e2e/gift.spec.ts` reads the referral link now that the page
 * no longer prints it. One buddy section renders per page, so there is nothing
 * to collide with.
 */
const BUDDY_LINK_ID = "buddy-link";

/**
 * **Bring a buddy next time** — ADR 20260908-one-hand, decision 6, lever W.
 *
 * The share sheet first, a clipboard copy where there is none, which is the
 * same shape `FollowShareRow` uses one state earlier in this thread. A browser
 * without the Web Share API is a laptop, where a copied link is what a person
 * wanted anyway.
 *
 * **The URL is no longer printed on the page.** It used to render in full,
 * mono, under a "Your link" caption, on the argument that a diver about to
 * paste it into a message likes to see it — but a recap already runs about
 * twenty controls down one column, and a raw URL is the loudest thing in a
 * block of prose while being the one thing nobody reads (2026-09-17 design
 * review). The control is the affordance; the errand is *sending* it, and both
 * the share sheet and the clipboard carry the link without anybody looking at
 * it.
 *
 * What the URL is still owed is a reader who cannot see the share sheet's
 * preview, so it stays in the accessible tree as this button's **description**
 * — not its name. A name of "Share your link: https://…" would stop matching
 * the visible words the moment the button reports back ("Link copied"), which
 * is exactly what WCAG's Label in Name forbids; a description carries the same
 * fact and is announced after the name. That same element becomes visible on a
 * refused clipboard, which is the one state where "select the link and copy it
 * yourself" is advice rather than a dead end.
 *
 * The link is signed and non-secret — it names a booking and authorizes nothing
 * (`src/lib/buddy-tokens.ts`) — so unlike this page's own URL it is safe in a
 * group chat.
 */
export function BuddyShareButton({
  url,
  action,
  copied: copiedLabel,
  copyFailed,
}: {
  /** The shop's public schedule, carrying this booking's referral id. */
  url: string;
  action: string;
  copied: string;
  copyFailed: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    if (navigator.share) {
      // No title and no text: the destination is the shop's own schedule, whose
      // link preview says who it is better than a sentence DiveDay writes for
      // the diver would.
      await navigator.share({ url }).catch((error: unknown) => {
        // A share sheet the reader dismissed is not a failure to report.
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      });
      return;
    }
    const ok = await copyToClipboard(url);
    setStatus(ok ? "copied" : "failed");
    setTimeout(() => setStatus("idle"), 4000);
  }

  const label = status === "copied" ? copiedLabel : status === "failed" ? copyFailed : action;

  return (
    <>
      {/* The button's own name is the whole feedback, and it keeps focus after
          the tap — so no `aria-live` twin says the same three words again. */}
      <button
        type="button"
        onClick={share}
        aria-describedby={BUDDY_LINK_ID}
        className={buttonClass({ variant: "secondary", className: "mt-4" })}
      >
        {label}
      </button>
      {/* One element, two jobs. It is always the button's description, so a
          screen reader can learn what is about to be sent; and it becomes
          *visible* exactly when the clipboard refused, because that is the
          moment `recap.buddyCopyFailed` — "Select the link and copy it
          yourself" — starts describing something a reader can actually do.
          Printing it at rest is what this control exists to stop; printing it
          on a dead end is the one state where the words need a link under
          them. */}
      <p
        id={BUDDY_LINK_ID}
        className={
          status === "failed" ? "mt-3 font-mono text-xs break-all text-foreground" : "sr-only"
        }
      >
        {url}
      </p>
    </>
  );
}
