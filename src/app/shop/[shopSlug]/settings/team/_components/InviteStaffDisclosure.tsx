import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import {
  ChoicePill,
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { staffRoleLabelRecord } from "@/i18n/staff-role-labels";
import { STAFF_ROLES } from "@/lib/authz";
import type { FormNotice } from "@/lib/staff-notices";
import { inviteStaffAction } from "../actions";

/**
 * The invite form's role picker. A roster row's is `StaffRolesDisclosure` —
 * the per-row disclosure that saves on close (ADR 20260827-the-shops-shelves,
 * slice 9h). This one stays a plain fieldset because it is one part of a form
 * with its own Send invite: there is nothing to close, and nothing to save yet.
 */
function RoleCheckboxes({
  name,
  defaultRoles,
  t,
}: {
  name: string;
  defaultRoles: readonly string[];
  t: StaffTranslator;
}) {
  const labels = staffRoleLabelRecord(t);
  return (
    <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <legend className="sr-only">{t("settings.team.rolesLegend")}</legend>
      {STAFF_ROLES.map((role) => (
        <ChoicePill
          key={role}
          type="checkbox"
          name={`${name}_${role}`}
          defaultChecked={defaultRoles.includes(role)}
        >
          {labels[role]}
        </ChoicePill>
      ))}
    </fieldset>
  );
}

/**
 * **Inviting is a button under the team** (fifth-loop ideas, item 58): the
 * page used to open on a blank invite form above the people it was about. The
 * form opens in place under the button, and opens itself when the invite just
 * failed or a link points at `#invite` (the roster's empty state).
 */
export function InviteStaffDisclosure({
  emailError,
  status,
  notice,
  t,
}: {
  /** The email field's own error, when the last invite was refused for it. */
  emailError: string | undefined;
  /** The invite form's notice, when the page's notice is this form's. */
  status: FormNotice | undefined;
  /** The raw `?notice=`, keying the error focus so it fires once per redirect. */
  notice: string | undefined;
  t: StaffTranslator;
}) {
  return (
    <AutoOpenDetails
      id="invite"
      openOnHash="invite"
      open={Boolean(emailError || status)}
      className="mt-4 scroll-mt-24 print:hidden"
    >
      <summary
        className={buttonClass({
          variant: "secondary",
          className: "list-none select-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {t("settings.team.invite.heading")}
      </summary>
      <div className={sectionCardClass({ padding: "lg", className: "mt-3" })}>
        <p className="mb-4 text-sm text-muted">{t("settings.team.invite.description")}</p>
        <FieldGrid as="form" action={inviteStaffAction} columns={2}>
          <Field label={t("settings.team.invite.fullNameLabel")}>
            <input
              name="fullName"
              type="text"
              required
              maxLength={120}
              autoComplete="name"
              className={controlClass}
            />
          </Field>
          <Field label={t("settings.team.invite.emailLabel")} error={emailError}>
            <input
              name="email"
              type="email"
              required
              maxLength={150}
              autoComplete="email"
              className={controlClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <RoleCheckboxes name="role" defaultRoles={[]} t={t} />
          </div>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("settings.team.invite.submitting")}
              className={buttonClass()}
            >
              {t("settings.team.invite.submit")}
            </SubmitButton>
            <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
          </FieldActions>
          <FieldErrorFocus key={notice} scope="invite" />
        </FieldGrid>
      </div>
    </AutoOpenDetails>
  );
}
