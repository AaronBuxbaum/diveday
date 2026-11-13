import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { LedgerRow } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDateRange } from "@/lib/format";

type Pending = {
  id: string;
  personName: string;
  startsOn: string;
  endsOn: string;
  note: string | null;
};

/**
 * **The owner's approval box**: every day-off ask waiting on an answer, with Approve, Decline and
 * an optional reason the asker reads back on their own Shifts tab. Renders nothing when empty.
 */
export function TimeOffApprovals({
  pending,
  locale,
  t,
  decideAction,
}: {
  pending: readonly Pending[];
  locale: string;
  t: StaffTranslator;
  decideAction: (formData: FormData) => void;
}) {
  if (pending.length === 0) return null;
  return (
    <section aria-labelledby="time-off-approvals-heading" className="pb-8">
      <h2 id="time-off-approvals-heading" className="mb-3 font-semibold">
        {t("staffing.mine.approvalsHeading")}
      </h2>
      <ul>
        {pending.map((ask) => (
          <LedgerRow key={ask.id} stacked trailing={null}>
            <form action={decideAction} className="flex flex-col gap-3">
              <input type="hidden" name="blockId" value={ask.id} />
              <p className="text-base">
                {t("staffing.mine.asked", {
                  person: ask.personName,
                  dates: formatCalendarDateRange(ask.startsOn, ask.endsOn, locale),
                })}
                {ask.note ? <span className="block text-muted">{ask.note}</span> : null}
              </p>
              <input
                name="reason"
                maxLength={200}
                aria-label={`${t("staffing.mine.reasonLabel")} ${t("staffing.mine.reasonHint")}`}
                placeholder={t("staffing.mine.reasonPlaceholder")}
                className={controlClass}
              />
              <div className="flex gap-2">
                <SubmitButton
                  name="decision"
                  value="approved"
                  pendingLabel={t("words.busy.saving")}
                  className={buttonClass()}
                >
                  {t("staffing.mine.approve")}
                </SubmitButton>
                <SubmitButton
                  name="decision"
                  value="declined"
                  pendingLabel={t("words.busy.saving")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("staffing.mine.decline")}
                </SubmitButton>
              </div>
            </form>
          </LedgerRow>
        ))}
      </ul>
    </section>
  );
}
