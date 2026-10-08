import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { ServiceReminderState } from "@/db/work-order-follow-up";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { setCustomerGearRemindersAction } from "../../../gear/work-orders/follow-up-actions";

/**
 * **Per-piece opt-out for the service-due reminder** (ADR
 * 20261008-work-order-follow-up). Reminders are on by default, about a month
 * before each due date; this is the one switch that stops them for a piece
 * whose owner has asked, without touching any other piece or any other
 * message the shop sends.
 */
export function ServiceReminderToggle({
  customerGearItemId,
  personId,
  pieceLabel,
  state,
  locale,
  timezone,
  t,
}: {
  customerGearItemId: string;
  personId: string;
  pieceLabel: string;
  state: ServiceReminderState;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const fact = state.off
    ? t("benchFollowUp.reminders.off")
    : state.lastSentAt
      ? t("benchFollowUp.reminders.lastSent", {
          date: formatShortDate(state.lastSentAt, locale, timezone),
        })
      : null;
  return (
    <form action={setCustomerGearRemindersAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="customerGearItemId" value={customerGearItemId} />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="on" value={state.off ? "true" : "false"} />
      {fact ? <span className="text-muted text-xs">{fact}</span> : null}
      <SubmitButton
        pendingLabel={t("benchFollowUp.reminders.saving")}
        className={buttonClass({ variant: "ghost", size: "sm" })}
        aria-label={
          state.off
            ? t("benchFollowUp.reminders.turnOnFor", { label: pieceLabel })
            : t("benchFollowUp.reminders.turnOffFor", { label: pieceLabel })
        }
      >
        {state.off ? t("benchFollowUp.reminders.turnOn") : t("benchFollowUp.reminders.turnOff")}
      </SubmitButton>
    </form>
  );
}
