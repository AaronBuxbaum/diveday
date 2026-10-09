import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { ReadyPageData } from "@/db/ready";
import type { DiverTranslator } from "@/i18n/messages";
import { formatTime } from "@/lib/format";
import { sayRunningLateAction } from "../actions";

/**
 * **"Running late"** (J3): one tap that puts "Running late, said 7:42" on the
 * shop's arrivals list instead of a blank. Drawn only while the seat can say
 * it (`ReadyPageData.runningLate.open`: booked, not checked in, inside the
 * twelve hours before the boat leaves). Once said, the line says when, in the
 * shop's zone, which is the clock the crew reads it against. No confirm: it
 * releases nothing and gates nothing. First under the spine, because on the
 * morning it is open it is the one thing on the page with a clock on it.
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
  if (data.runningLate.saidAt) {
    return (
      <p className="text-base text-muted">
        {t("ready.lateSaid", {
          time: formatTime(data.runningLate.saidAt, locale, data.detail.shop.timezone),
        })}
      </p>
    );
  }
  return (
    <form
      action={sayRunningLateAction.bind(null, token)}
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <p className="text-base text-muted">{t("ready.lateLead")}</p>
      <div>
        <SubmitButton
          pendingLabel={t("ready.lateSending")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("ready.lateButton")}
        </SubmitButton>
      </div>
    </form>
  );
}
