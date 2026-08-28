import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
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
 * level on one of the three public forms that ask —
 * `certifications.selfDeclaredAt`) has no number *the shop holds* and would
 * otherwise inherit that same tap, promoting a stranger's typing to `verified` —
 * the state readiness and the nitrox fill gate read. A number the diver typed
 * beside their level lands in `declaredIdentifier` and changes nothing here: it
 * is the thing being checked, never the check.
 *
 * So this is the exception, and it is deliberately the *same work* as capturing
 * a card rather than an extra attestation checkbox: name the agency, type the
 * number, **and say which rung the card shows**. That is the moment the diver's
 * claim stops being the evidence. It is enforced twice behind this form —
 * `reviewCertification` refuses without a number, and so does the database's own
 * `certifications_identifier_present_unless_self_declared`, which since
 * 2026-08-15 refuses a blank one and not merely a NULL (it read
 * `identifier is not null`, and `''` satisfies that, so this sentence used to
 * overstate what the constraint held).
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
  numberError,
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
  /**
   * Why the number they typed was refused, in the shop's language — the
   * `card-number-implausible` refusal, routed here rather than to the section's
   * action row because it is about one box.
   *
   * Set, it also **opens the disclosure**. A refusal rendered inside a shut
   * `<details>` is worse than the page-top banner it replaces: invisible rather
   * than merely far away, which is the state that taught staff to go around
   * this form instead of using it.
   */
  numberError?: string;
}) {
  return (
    <details className="min-w-0" open={Boolean(numberError)}>
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
        className={sectionCardClass({ className: "mt-2 gap-y-3 sm:w-72" })}
      >
        <input type="hidden" name="certificationId" value={certificationId} />
        {cardType ? <input type="hidden" name="cardType" value={cardType} /> : null}
        <Field
          label={t("divers.certifications.agency")}
          /* The nitrox twin needs its own sentence, not a shorter version of
             this one. "Type what the card in your hand says" reads as *the
             nitrox card* — and a RAID or GUE diver has no standalone enriched-
             air card, because the gas is part of their level certification. A
             staffer holding that diver's only card was being told, in effect,
             that the right card did not exist, with a required number field
             underneath. */
          description={t(
            cardType === "nitrox"
              ? "divers.certifications.sightNitroxCardHint"
              : "divers.certifications.sightCardHint",
          )}
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
        <Field
          label={t("divers.certifications.cardNumber")}
          // Visible, not only the input's `title`. A tooltip does not exist on
          // the phone or the wet tablet this form is actually used on, and the
          // two fields above it already state their rules in the open — so the
          // one field with a shape a submit can be refused for was the only one
          // keeping its rule hidden (`dive-domain-expert`, 2026-08-15).
          description={t("divers.certifications.cardNumberShapeHint")}
          error={numberError}
        >
          {/* The description and title explain the expected shape; the server
              action remains the validation gate so its inline refusal is visible. */}
          <input
            name="sightedIdentifier"
            required
            title={t("divers.certifications.cardNumberShapeHint")}
            className={controlClass}
          />
        </Field>
        <SubmitButton
          pendingLabel={t("divers.certifications.markingCertified")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("divers.certifications.markCertified")}
        </SubmitButton>
        {/* No `field` id: two sighting forms can in principle render at once and
            a shared id would be a duplicate, so this takes `Field`'s own
            `aria-invalid` marker instead. Keyed on the message so an identical
            repeat refusal still re-fires. */}
        {numberError ? <FieldErrorFocus key={numberError} /> : null}
      </FieldGrid>
    </details>
  );
}
