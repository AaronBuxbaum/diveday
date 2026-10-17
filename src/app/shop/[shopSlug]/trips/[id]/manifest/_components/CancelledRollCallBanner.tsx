import { TONE_PANEL_CLASS } from "@/components/ui/card";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CancelledRollCall } from "@/lib/roll-call";

/**
 * **A cancelled departure says so above its head count** (#2285), and says
 * what that means for the roll call under it: closed when nobody was counted
 * before the cancel (the rows below carry no control), still open when the
 * count had begun (dive-domain review, 2026-10-09). Nothing for a departure
 * that is not cancelled.
 */
export function CancelledRollCallBanner({
  state,
  t,
}: {
  state: CancelledRollCall | null;
  t: StaffTranslator;
}) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={`mt-5 ${TONE_PANEL_CLASS} border-warning/40 bg-warning/10 font-medium`}
    >
      {state === "closed"
        ? t("manifest.cancelledRollCallClosed")
        : t("manifest.cancelledRollCallStillCounting")}
    </p>
  );
}
