"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { copyToClipboard } from "@/components/Copyable";

/**
 * The hero's two conveniences, at link weight. `min-h-11` keeps the 44px
 * target the ghost buttons used to give them.
 */
const QUIET_LINK_CLASS =
  "inline-flex min-h-11 items-center font-medium text-primary hover:underline";

export function TripActions({
  calendarUrl,
  shareUrl,
}: {
  calendarUrl: string;
  /**
   * What "share with a buddy" actually hands over. Defaults to the page's own
   * URL, which is right on the public trip page and **wrong** on `/ready`,
   * whose URL *is* a bearer capability: sharing it into a group chat would hand
   * a buddy the power to cancel the booking and move its refund
   * (docs/engineering/capability-telemetry-runbook.md). `/ready` passes the
   * public trip page instead — the thing a diver means to share anyway.
   */
  shareUrl?: string;
}) {
  const t = useTranslations("trip");
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function shareTrip() {
    const url = shareUrl ?? window.location.href;
    const data = {
      title: document.title,
      text: t("shareText"),
      url,
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
    const ok = await copyToClipboard(url);
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
    // Two quiet text links inside the hero, not a row of buttons under it (ADR
    // 20260827-the-divers-thread, decision 2). They were `buttonClass` ghosts
    // until 2026-08-28, which still read as controls: a button-shaped thing
    // sitting between the price and the one primary action competes with it
    // however light its fill is. A convenience gets link weight.
    <fieldset className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <legend className="sr-only">{t("planAndShare")}</legend>
      <a href={calendarUrl} className={QUIET_LINK_CLASS}>
        {t("addToCalendar")}
      </a>
      <span aria-hidden="true" className="text-muted">
        ·
      </span>
      {/* No "Get directions" here. The trip page already carries the site's
          own map and its link out (`DiveSiteMap`), and a *second* door to the
          same maps app — sitting in the plan-and-share row, before a diver has
          booked anything — was a third button competing with the one that
          matters on this page. Removed 2026-08-13 at the product owner's call. */}
      <button type="button" onClick={shareTrip} className={QUIET_LINK_CLASS}>
        {label}
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </fieldset>
  );
}
