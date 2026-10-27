import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { ReadyPageData } from "@/db/ready";
import type { DiverTranslator } from "@/i18n/messages";
import { formatTime } from "@/lib/format";
import { clearRunningLateAction, sayRunningLateAction } from "../day-of-actions";

/**
 * **"Running late"** (J3): puts "Running late, said 7:42" on the shop's
 * arrivals list instead of a blank. Drawn only while the seat can say it
 * (`ReadyPageData.runningLate.open`: booked, not checked in, from the
 * night-before brief until the boat has sailed). Once said, the line says
 * when, in the shop's zone, which is the clock the crew reads it against.
 *
 * **Asked once, and taken back with the same control** (third UX review, item
 * 26). It releases nothing and gates nothing, but a false "late" moves a crew
 * member, and one thumb the night before used to say it for good. So the tap
 * asks first, the shape "Cancel my spot" has, naming the call the diver would
 * miss; and once said, "I'm on time after all" clears it. First under the
 * spine, because on the morning it is open it is the one thing on the page
 * with a clock on it.
 */
export function RunningLate({
  token,
  data,
  locale,
  t,
}: {
  token: string;
  data: ReadyPageData;
  locale: string;
  t: DiverTranslator;
}) {
  if (!data.runningLate.open) return null;
  const tz = data.detail.shop.timezone;
  if (data.runningLate.saidAt) {
    return (
      <form
        action={clearRunningLateAction.bind(null, token)}
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        <p className="text-base text-muted">
          {t("ready.lateSaid", { time: formatTime(data.runningLate.saidAt, locale, tz) })}
        </p>
        <div className="print:hidden">
          <SubmitButton
            pendingLabel={t("ready.lateSending")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("ready.lateUndo")}
          </SubmitButton>
        </div>
      </form>
    );
  }
  // The call the diver would be late for: the dock call, unless the shop is
  // collecting them, when the pickup time is theirs and not the dock's.
  const dockCallAt = new Date(
    data.detail.trip.startsAt.getTime() - data.shop.dockCallMinutes * 60_000,
  );
  return (
    <form
      action={sayRunningLateAction.bind(null, token)}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden"
    >
      <p className="text-base text-muted">{t("ready.lateLead")}</p>
      <InlineConfirm
        triggerLabel={t("ready.lateButton")}
        triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
        message={
          data.pickupTime
            ? t("ready.lateConfirmPlain")
            : t("ready.lateConfirm", { time: formatTime(dockCallAt, locale, tz) })
        }
        confirmLabel={t("ready.lateConfirmButton")}
        cancelLabel={t("ready.neverMind")}
        pendingLabel={t("ready.lateSending")}
        confirmClassName={buttonClass({ size: "sm" })}
      />
    </form>
  );
}
