import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CertificationLevel } from "@/lib/certification-levels";
import { AGENCY_KEYS } from "../../../../divers/[personId]/_components/shared";
import { recordCounterRentalCardAction } from "../../actions";

/**
 * **What the counter knows about this person's cards**, and the way to tell
 * it more: the highest verified level, the drysuit card, cards on file that
 * do not count yet, and whether they are a minor on the first day.
 *
 * "Card seen" is the diver record's capture-and-certify act, here because the
 * card is in the staffer's hand here (`recordCounterRentalCardSighting`): the
 * agency and number are written down and the staffer is recorded as the one
 * who saw it. Offered while life support on offer would still be refused.
 */
export function RentalCardSeen({
  t,
  personId,
  from,
  until,
  summary,
  minor,
  drysuitOnOffer,
}: {
  t: StaffTranslator;
  personId: string;
  from: string;
  until: string;
  summary: { verifiedLevel: CertificationLevel | null; drysuit: boolean; unverified: number };
  minor: boolean;
  /** A drysuit is free for these days, so a missing drysuit card is worth offering to record. */
  drysuitOnOffer: boolean;
}) {
  const facts = [
    summary.verifiedLevel
      ? t("counterRentals.new.cards.verified", {
          level: t(CERTIFICATION_LEVEL_KEYS[summary.verifiedLevel]),
        })
      : t("counterRentals.new.cards.none"),
    summary.drysuit ? t("counterRentals.new.cards.drysuit") : null,
    summary.unverified > 0
      ? t("counterRentals.new.cards.unverified", { count: summary.unverified })
      : null,
    minor ? t("counterRentals.new.cards.minor") : null,
  ].filter((fact): fact is string => fact !== null);
  const offer = !summary.verifiedLevel || (drysuitOnOffer && !summary.drysuit);

  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className={`text-sm ${summary.verifiedLevel ? "text-muted" : "text-warning-strong"}`}>
        {facts.join(" · ")}
      </p>
      {offer ? (
        <details className="group">
          <summary
            className={buttonClass({
              variant: "link",
              size: "sm",
              flush: true,
              className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
            })}
          >
            {t("counterRentals.new.cards.seen")}
          </summary>
          <FieldGrid as="form" action={recordCounterRentalCardAction} columns={2} className="mt-3">
            <input type="hidden" name="personId" value={personId} />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="until" value={until} />
            <Field label={t("divers.certifications.cardLabel")}>
              <select
                name="card"
                className={controlClass}
                defaultValue={summary.verifiedLevel ? "specialty:drysuit" : "level:open_water"}
              >
                {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                  <option key={value} value={`level:${value}`}>
                    {t(key)}
                  </option>
                ))}
                <option value="specialty:drysuit">{t(SPECIALTY_KEYS.drysuit)}</option>
              </select>
            </Field>
            <Field label={t("divers.certifications.agency")}>
              <select name="agency" className={controlClass}>
                {Object.entries(AGENCY_KEYS).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("divers.certifications.cardNumber")}>
              <input name="identifier" required maxLength={120} className={controlClass} />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("counterRentals.new.cards.recording")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("counterRentals.new.cards.record")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </details>
      ) : null}
    </div>
  );
}
