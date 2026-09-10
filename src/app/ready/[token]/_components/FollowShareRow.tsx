"use client";

import { useState } from "react";
import { copyToClipboard } from "@/components/Copyable";
import { SiteMark } from "@/components/illustration/SiteMark";

/**
 * **Share with whoever is waiting for you** — ADR 20260908-one-hand, decision
 * 6, lever U.
 *
 * One row on the diver's thread that hands the phone's share sheet the boat's
 * public link and one sentence. The link is **the boat's, not the diver's**:
 * two divers on the same departure share the same page, and nothing on it is
 * theirs to revoke. That is the whole reason this cannot be a share of
 * `window.location.href` — this page's URL *is* a bearer capability, and
 * sending it into a group chat would hand a cousin the power to cancel the
 * booking and move its refund (docs/engineering/capability-telemetry-runbook.md,
 * and `TripActions`' `shareUrl`, which learned it first).
 *
 * The fallback is a copy, the same one every other copy control in this app
 * uses. A browser with no Web Share API is a laptop, where a copied link is
 * what a person wanted anyway.
 */
export function FollowShareRow({
  url,
  text,
  heading,
  detail,
  action,
  copied: copiedLabel,
  copyFailed,
}: {
  /** The public boat page, absolute where an origin is configured. */
  url: string;
  /** "Mantis II's day, from Blue Mantis Divers" — composed server-side. */
  text: string;
  heading: string;
  detail: string;
  action: string;
  copied: string;
  copyFailed: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: text, text, url }).catch((error: unknown) => {
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
    <div className="mt-6 flex items-center gap-3 rounded-panel bg-surface-sunken p-4">
      <SiteMark mark="boat" size="sm" ground="surface" coral={false} />
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium">{heading}</p>
        <p className="mt-0.5 text-sm text-muted">{detail}</p>
      </div>
      {/* The button's own name is the whole feedback, and it keeps focus after
          the tap — so there is no `aria-live` twin here saying the same three
          words a second time. `TripActions` carries one because its
          announcement is different copy from its label; a live region echoing
          the label is two announcements of one event. */}
      <button
        type="button"
        onClick={share}
        className="inline-flex min-h-11 shrink-0 items-center font-medium text-primary hover:underline"
      >
        {label}
      </button>
    </div>
  );
}
