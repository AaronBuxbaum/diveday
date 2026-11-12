import Image from "next/image";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { ChoiceRow, controlClass, Field, FieldActions } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { CREW_PUBLIC_NAME_MAX, defaultCrewPublicName } from "@/lib/crew-public-name";
import type { PublicStaffProfile } from "@/lib/public-staff-profile";
import { saveCrewPublicConsentAction } from "../profile-actions";
import { saveStaffProfileAction } from "../staff-profile-actions";
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
    publicStaffProfileEnabled: boolean;
    publicStaffProfile: PublicStaffProfile | null;
  };
  t: StaffTranslator;
}) {
  const crewConsented = person.crewPublicConsentAt != null;
  const crewPublicName = person.crewPublicName ?? defaultCrewPublicName(person.fullName);
  return (
    <>
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
      <CompactDisclosureRow
        label={t("staffing.publicProfile.heading")}
        value={t(
          person.publicStaffProfileEnabled
            ? "staffing.publicProfile.visible"
            : "staffing.publicProfile.hidden",
        )}
      >
        <form action={saveStaffProfileAction.bind(null, shopSlug)} className="flex flex-col gap-3">
          <input type="hidden" name="personId" value={person.id} />
          <ChoiceRow
            type="checkbox"
            name="profileEnabled"
            defaultChecked={person.publicStaffProfileEnabled}
          >
            {t("staffing.publicProfile.consent")}
          </ChoiceRow>
          <Field label={t("staffing.publicProfile.firstName")}>
            <input
              className={controlClass}
              name="profileFirstName"
              maxLength={60}
              defaultValue={person.publicStaffProfile?.firstName ?? ""}
            />
          </Field>
          <Field label={t("staffing.publicProfile.role")}>
            <input
              className={controlClass}
              name="profileRole"
              maxLength={80}
              defaultValue={person.publicStaffProfile?.role ?? ""}
            />
          </Field>
          <Field label={t("staffing.publicProfile.since")}>
            <input
              className={controlClass}
              type="number"
              min={1900}
              max={2100}
              name="profileSinceYear"
              defaultValue={person.publicStaffProfile?.sinceYear ?? ""}
            />
          </Field>
          <Field label={t("staffing.publicProfile.languages")}>
            <input
              className={controlClass}
              name="profileLanguages"
              maxLength={160}
              defaultValue={person.publicStaffProfile?.languages ?? ""}
            />
          </Field>
          <Field label={t("staffing.publicProfile.description")}>
            <textarea
              className={controlClass}
              name="profileDescription"
              maxLength={1000}
              defaultValue={person.publicStaffProfile?.description ?? ""}
            />
          </Field>
          {(person.publicStaffProfile?.photoUrls ?? []).map((url, index) => (
            <ChoiceRow key={url} type="checkbox" name="removeProfilePhoto" value={url}>
              <Image
                src={url}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 rounded-lg object-cover"
              />
              {t("staffing.publicProfile.removePhoto", { number: index + 1 })}
            </ChoiceRow>
          ))}
          <Field label={t("staffing.publicProfile.photos")}>
            <input
              className={controlClass}
              name="profilePhotos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
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
    </>
  );
}
