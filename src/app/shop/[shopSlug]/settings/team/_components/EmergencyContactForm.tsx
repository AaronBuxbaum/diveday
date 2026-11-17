import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { noticeForForm } from "@/lib/staff-notices";
import { saveStaffEmergencyContactAction } from "../actions";

/** One crew member's emergency contact: a name and a number, either may stay blank. */
export function EmergencyContactForm({
  member,
  status,
  t,
}: {
  member: {
    personId: string;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  };
  status: ReturnType<typeof noticeForForm>;
  t: StaffTranslator;
}) {
  const optional = t("settings.team.emergencyContact.optionalHint");
  return (
    <FieldGrid as="form" action={saveStaffEmergencyContactAction} columns={2} className="mt-3">
      <input type="hidden" name="personId" value={member.personId} />
      <Field label={t("settings.team.emergencyContact.nameLabel")} hint={optional}>
        <input
          name="emergencyContactName"
          defaultValue={member.emergencyContactName ?? ""}
          autoComplete="off"
          className={controlClass}
        />
      </Field>
      <Field label={t("settings.team.emergencyContact.phoneLabel")} hint={optional}>
        <input
          name="emergencyContactPhone"
          type="tel"
          defaultValue={member.emergencyContactPhone ?? ""}
          autoComplete="off"
          className={controlClass}
        />
      </Field>
      <FieldActions>
        <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
        <SubmitButton
          pendingLabel={t("words.busy.saving")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {t("settings.team.emergencyContact.save")}
        </SubmitButton>
      </FieldActions>
    </FieldGrid>
  );
}
