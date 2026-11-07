import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cancelInviteAction, resendInviteAction } from "../actions";

/**
 * What a card offers for somebody who has not accepted yet: send the invite again, or withdraw
 * it (issue #4013). Cancel lands with an Undo toast, as Delete does for a teammate who joined.
 */
export function PendingInviteActions({
  member,
  t,
}: {
  member: { personId: string; userAccountId: string; fullName: string };
  t: StaffTranslator;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <form action={resendInviteAction}>
        <input type="hidden" name="userAccountId" value={member.userAccountId} />
        <SubmitButton
          pendingLabel={t("words.busy.sending")}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            className: "w-full sm:w-auto",
          })}
        >
          {t("settings.team.staffRow.resendInvite")}
        </SubmitButton>
      </form>
      <form action={cancelInviteAction}>
        <input type="hidden" name="personId" value={member.personId} />
        <input type="hidden" name="userAccountId" value={member.userAccountId} />
        <input type="hidden" name="fullName" value={member.fullName} />
        <SubmitButton
          pendingLabel={t("words.busy.canceling")}
          ariaLabel={t("settings.team.staffRow.cancelInviteAriaLabel", { name: member.fullName })}
          className={buttonClass({
            variant: "danger-ghost",
            size: "sm",
            className: "w-full sm:w-auto",
          })}
        >
          {t("settings.team.staffRow.cancelInvite")}
        </SubmitButton>
      </form>
    </div>
  );
}
