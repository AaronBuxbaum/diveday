import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CertificationLevel } from "@/lib/readiness";
import { AGENCY_KEYS } from "./shared";

/**
 * **The card in the staffer's hand, for a row that is so far only a diver's
 * word.**
 *
 * Every other pending card on this page certifies on one tap, and that is right:
 * a staffer already held something and typed its number, so the tap only records
 * that the number checked out. A **self-declared** card (a diver named their own
 * level on one of the two public opt-ins — `certifications.selfDeclaredAt`) has
 * no number at all and would otherwise inherit that same tap, promoting a
 * stranger's typing to `verified` — the state readiness and the nitrox fill gate
 * read.
 *
 * So this is the exception, and it is deliberately the *same work* as capturing
 * a card rather than an extra attestation checkbox: name the agency, type the
 * number, **and say which rung the card shows**. That is the moment the diver's
 * claim stops being the evidence. It is enforced twice behind this form —
 * `reviewCertification` refuses without a number, and so does the database's own
 * `certifications_identifier_present_unless_self_declared`.
 *
 * The level select is the part that is easy to leave out and shouldn't be. A
 * diver who overstates their level is the *likely* wrong claim, not the exotic
 * one, and without this control a staffer holding a genuine Open Water card
 * would type its number and unknowingly certify "Instructor". It is prefilled
 * with the claim so the ordinary case is still one glance and one tap — but the
 * glance is the whole point, so the words ask what the card says rather than
 * what the diver said.
 *
 * Collapsed by default so the row still reads as a list item rather than a form
 * — and because "certify this" is not the common answer to a self-declaration.
 * Often the right one is to leave it, or delete it.
 */
export function CardSightingForm({
  t,
  action,
  certificationId,
  cardType,
  claimedLevel,
}: {
  t: StaffTranslator;
  action: (formData: FormData) => void;
  certificationId: string;
  /** `nitrox` routes the shared specialty action to the nitrox table. */
  cardType?: "nitrox";
  /**
   * The rung the diver claimed, prefilling the level select. Absent on the
   * nitrox twin, whose table has no level — and its absence is what leaves that
   * form as agency + number, exactly as it was.
   */
  claimedLevel?: CertificationLevel;
}) {
  return (
    <details className="min-w-0">
      <summary
        className={buttonClass({
          variant: "secondary",
          size: "sm",
          className: "cursor-pointer list-none",
        })}
      >
        {t("divers.certifications.sightCard")}
      </summary>
      <FieldGrid
        as="form"
        action={action}
        columns={1}
        className="mt-2 gap-y-3 rounded-lg border border-border bg-surface p-3 sm:w-72"
      >
        <input type="hidden" name="certificationId" value={certificationId} />
        {cardType ? <input type="hidden" name="cardType" value={cardType} /> : null}
        <Field
          label={t("divers.certifications.agency")}
          description={t("divers.certifications.sightCardHint")}
        >
          <select name="sightedAgency" className={controlClass}>
            {Object.entries(AGENCY_KEYS).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </Field>
        {claimedLevel ? (
          <Field
            label={t("divers.certifications.sightCardLevel")}
            description={t("divers.certifications.sightCardLevelHint")}
          >
            <select name="sightedLevel" defaultValue={claimedLevel} className={controlClass}>
              {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label={t("divers.certifications.cardNumber")}>
          <input name="sightedIdentifier" required className={controlClass} />
        </Field>
        <SubmitButton
          pendingLabel={t("divers.certifications.markingCertified")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("divers.certifications.markCertified")}
        </SubmitButton>
      </FieldGrid>
    </details>
  );
}
