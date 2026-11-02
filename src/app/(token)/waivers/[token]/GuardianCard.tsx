import type { ReactNode } from "react";
import { SectionCard } from "@/components/ui/card";
import { ChoiceRow, controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import type { DraftGuardian } from "@/db/schema/waivers";
import { diverGuardianRelationshipOptions } from "@/i18n/guardian-labels";
import type { DiverTranslator } from "@/i18n/messages";
import { SectionHeading } from "./SectionHeading";
import type { WaiverFieldError } from "./waiver-fields";

/**
 * **The guardian's card** (ADR 20260907-guardian-co-signature): the second
 * signature a minor's release takes. `children` is the page's one sign block,
 * so the last thing on the page is still the act.
 */
export function GuardianCard({
  children,
  diverName,
  draftGuardian,
  namedFieldError,
  t,
}: {
  children: ReactNode;
  diverName: string;
  draftGuardian: DraftGuardian | null;
  namedFieldError: WaiverFieldError | undefined;
  t: DiverTranslator;
}) {
  return (
    <SectionCard padding="lg">
      <SectionHeading>{t("waiver.guardianHeading")}</SectionHeading>
      <p className="mt-2 text-sm text-muted">{t("waiver.guardianIntro", { name: diverName })}</p>
      <FieldGrid columns={2} className="mt-4">
        <Field
          label={t("waiver.guardianName")}
          error={
            namedFieldError?.anchor === "guardianName" ? t(namedFieldError.textKey) : undefined
          }
        >
          <input
            id="guardianName"
            name="guardianName"
            autoComplete="off"
            required
            minLength={2}
            maxLength={120}
            defaultValue={draftGuardian?.name ?? ""}
            className={controlClass}
          />
        </Field>
        <Field
          label={t("waiver.guardianEmail")}
          // Optional since issue #1453, and the description says what
          // giving one buys — an address collected under no stated
          // purpose is the wrong end of the promise.
          description={t("waiver.guardianEmailDescription")}
          error={
            namedFieldError?.anchor === "guardianEmail" ? t(namedFieldError.textKey) : undefined
          }
        >
          <input
            id="guardianEmail"
            name="guardianEmail"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={200}
            defaultValue={draftGuardian?.email ?? ""}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <FieldGrid columns={1} className="mt-4">
        <Field
          label={t("waiver.guardianRelationship", {
            name: diverName,
          })}
          error={
            namedFieldError?.anchor === "guardianRelationship"
              ? t(namedFieldError.textKey)
              : undefined
          }
        >
          <select
            id="guardianRelationship"
            name="guardianRelationship"
            required
            defaultValue={draftGuardian?.relationship ?? ""}
            className={controlClass}
          >
            <option value="" disabled>
              {t("waiver.guardianRelationshipChoose")}
            </option>
            {diverGuardianRelationshipOptions(t).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      <ChoiceRow
        type="checkbox"
        id="guardianAcknowledged"
        name="guardianAcknowledged"
        value="on"
        required
        // Kept across a refusal, like the diver's own box above: a
        // family that hit one refusal should not have to re-read and
        // re-tick the agreement to try the next answer.
        defaultChecked={draftGuardian?.acknowledged ?? false}
        aria-invalid={namedFieldError?.anchor === "guardianAcknowledged" ? "true" : undefined}
        aria-describedby={
          namedFieldError?.anchor === "guardianAcknowledged"
            ? "guardianAcknowledged-error"
            : undefined
        }
        className="mt-4 text-base"
      >
        {t("waiver.guardianAgreementCheckbox")}
      </ChoiceRow>
      {namedFieldError?.anchor === "guardianAcknowledged" ? (
        <FormStatus id="guardianAcknowledged-error" className="mt-2">
          {t(namedFieldError.textKey)}
        </FormStatus>
      ) : null}
      {children}
    </SectionCard>
  );
}
