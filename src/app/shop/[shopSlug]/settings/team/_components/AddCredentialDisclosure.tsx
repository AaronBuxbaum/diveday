import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, DateField, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { StaffMember } from "@/db/staff-accounts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { saveStaffCredentialAction } from "../actions";
import { CREDENTIAL_KIND_KEYS } from "../credential-kinds";

export function AddCredentialDisclosure({
  staff,
  credentialFor,
  t,
}: {
  staff: readonly StaffMember[];
  credentialFor?: string;
  t: StaffTranslator;
}) {
  const credentialPerson =
    staff.find((member) => member.personId === credentialFor)?.personId ?? "";
  return (
    <div className="mt-4 print:hidden">
      <AutoOpenDetails
        id="add-credential"
        openOnHash="add-credential"
        open={Boolean(credentialPerson)}
        className="scroll-mt-8"
      >
        <summary
          className={buttonClass({
            variant: "link",
            flush: true,
            className: "list-none select-none [&::-webkit-details-marker]:hidden",
          })}
        >
          {t("staffing.credentials.add")}
        </summary>
        <div className="pt-1 pb-6">
          <FieldGrid as="form" action={saveStaffCredentialAction} columns={2}>
            <Field label={t("staffing.credentials.person")}>
              <select
                key={credentialPerson}
                name="personId"
                required
                defaultValue={credentialPerson}
                className={controlClass}
              >
                <option value="">{t("staffing.credentials.choosePerson")}</option>
                {staff.map((member) => (
                  <option key={member.personId} value={member.personId}>
                    {member.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("staffing.credentials.kind")}>
              <select name="kind" required className={controlClass}>
                {Object.entries(CREDENTIAL_KIND_KEYS).map(([kind, key]) => (
                  <option key={kind} value={kind}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("staffing.credentials.name")}>
              <input name="name" required maxLength={160} className={controlClass} />
            </Field>
            <Field label={t("staffing.credentials.issuer")}>
              <input name="issuingBody" maxLength={160} className={controlClass} />
            </Field>
            <Field label={t("staffing.credentials.identifier")}>
              <input name="identifier" maxLength={120} className={controlClass} />
            </Field>
            <Field label={t("staffing.credentials.issuedAt")}>
              <DateField name="issuedAt" />
            </Field>
            <Field label={t("staffing.credentials.renewsAt")}>
              <DateField name="renewsAt" />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("staffing.credentials.saving")}
                className={buttonClass()}
              >
                {t("staffing.credentials.add")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </div>
      </AutoOpenDetails>
    </div>
  );
}
