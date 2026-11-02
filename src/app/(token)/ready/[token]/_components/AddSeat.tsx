import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureRow, DisclosureRowList } from "@/components/ui/disclosure";
import { controlClass, Field } from "@/components/ui/form";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_NAME_MAX } from "@/lib/person-fields";

/**
 * **"Add a seat"** (UX review 2026-10-11, item 13): the diver who booked alone
 * brings a friend from their own page. One field, the friend's name, because
 * the seat is held under it until the friend claims it from the link the
 * party panel then shows — their own details, their own waiver.
 *
 * Folded by default: it is the page's least common act, and it sits with the
 * group's seats rather than among the steps a diver owes before boarding.
 * Rendered only when the booking may lead a seat (`canAddSeat`); whether the
 * boat has room is the action's to answer, in a notice.
 */
export function AddSeat({
  action,
  t,
}: {
  action: (formData: FormData) => Promise<void>;
  t: DiverTranslator;
}) {
  return (
    <DisclosureRowList className="print:hidden">
      <DisclosureRow id="add-seat" heading={t("seatClaim.addHeading")}>
        <p className="text-sm text-muted">{t("seatClaim.addBody")}</p>
        <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
          <Field label={t("seatClaim.addNameLabel")} className="min-w-56 flex-1">
            <input
              name="seatName"
              type="text"
              required
              maxLength={DIVER_NAME_MAX}
              autoComplete="off"
              className={controlClass}
            />
          </Field>
          <SubmitButton
            pendingLabel={t("seatClaim.addPending")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("seatClaim.addSubmit")}
          </SubmitButton>
        </form>
      </DisclosureRow>
    </DisclosureRowList>
  );
}
