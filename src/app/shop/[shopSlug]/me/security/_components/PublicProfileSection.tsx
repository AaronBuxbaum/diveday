import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { ChoiceRow, controlClass, Field, FieldActions } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { CREW_PUBLIC_NAME_MAX, defaultCrewPublicName } from "@/lib/crew-public-name";
import { saveCrewPublicConsentAction } from "../profile-actions";
export function PublicProfileSection({
  shopSlug,
  person,
  t,
}: {
  shopSlug: string;
  person: {
    id: string;
    fullName: string;
    crewPublicName: string | null;
    crewPublicConsentAt: Date | null;
  };
  t: StaffTranslator;
}) {
  const crewConsented = person.crewPublicConsentAt != null;
  const crewPublicName = person.crewPublicName ?? defaultCrewPublicName(person.fullName);
  return (
    <CompactDisclosureRow
      label={t("staffing.crewConsent.rowLabel")}
      value={
        crewConsented
          ? t("staffing.crewConsent.shownAs", { name: crewPublicName })
          : t("staffing.crewConsent.notShown")
      }
    >
      <form
        action={saveCrewPublicConsentAction.bind(null, shopSlug)}
        className="flex flex-col gap-3"
      >
        <input type="hidden" name="personId" value={person.id} />
        <ChoiceRow
          type="checkbox"
          name="consented"
          defaultChecked={crewConsented}
          className="text-sm"
        >
          {t("staffing.crewConsent.label")}
        </ChoiceRow>
        {/* Show the exact public name so consent never publishes an inferred surname. */}
        <Field label={t("staffing.crewConsent.nameLabel")}>
          <input
            name="publicName"
            defaultValue={crewPublicName}
            maxLength={CREW_PUBLIC_NAME_MAX}
            className={controlClass}
          />
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel={t("words.busy.saving")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("staffing.crewConsent.save")}
          </SubmitButton>
        </FieldActions>
      </form>
    </CompactDisclosureRow>
  );
}
