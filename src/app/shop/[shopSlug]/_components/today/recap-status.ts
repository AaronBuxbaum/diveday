import type { StaffTranslator } from "@/i18n/staff-messages";

/** A duration in the close-out's own rounding: minutes under an hour, whole hours past it. */
function recapDurationText(t: StaffTranslator, durationMs: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(durationMs) / 60_000));
  return minutes < 60
    ? t("closeout.recap.aboutMinutes", { count: minutes })
    : t("closeout.recap.aboutHours", { count: Math.max(1, Math.round(minutes / 60)) });
}

/**
 * Where a returned departure's recap stands, in one line for its close-out
 * station: sent (and how long ago), failed, paused, due, waiting (and for how
 * long), or with nothing scheduled.
 */
export function recapStatusLine(
  t: StaffTranslator,
  departure: { recapSentAt: Date | null; recapFailed: boolean; recapAutoSendPaused: boolean },
  autoSendAt: Date | null,
  now: Date,
): string {
  return departure.recapSentAt
    ? t("closeout.recap.summarySent", {
        duration: recapDurationText(t, now.getTime() - departure.recapSentAt.getTime()),
      })
    : departure.recapFailed
      ? t("closeout.recap.summaryFailed")
      : departure.recapAutoSendPaused
        ? t("closeout.recap.summaryPaused")
        : autoSendAt && autoSendAt.getTime() <= now.getTime()
          ? t("closeout.recap.summaryDue")
          : autoSendAt
            ? t("closeout.recap.summaryWaiting", {
                duration: recapDurationText(t, autoSendAt.getTime() - now.getTime()),
              })
            : t("closeout.recap.summaryNoScheduled");
}
