import { sayWords, sendLimitWords } from "@/i18n/shared-sentences";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { NoticeMessages } from "@/lib/staff-notices";

/** Built per request; see `NoticeMessages`. */
export function noticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    invited: { tone: "success", text: t("settings.team.notice.invited") },
    "invite-resent": { tone: "success", text: t("settings.team.notice.inviteResent") },
    "changes-saved": { tone: "success", text: t("settings.team.notice.changesSaved") },
    reactivated: { tone: "success", text: t("settings.team.notice.reactivated") },
    disabled: { tone: "success", text: t("settings.team.notice.disabled") },
    removed: { tone: "success", text: t("settings.team.notice.removed") },
    restored: { tone: "success", text: t("settings.team.notice.restored") },
    "restore-failed": { tone: "danger", text: t("settings.team.notice.restoreFailed") },
    "invite-invalid": { tone: "danger", text: t("settings.team.notice.inviteInvalid") },
    "send-limit": { tone: "warning", text: sayWords(t, sendLimitWords("invites")) },
    "roles-invalid": { tone: "danger", text: t("settings.team.notice.rolesInvalid") },
    "roles-conflict": { tone: "danger", text: t("settings.team.notice.rolesConflict") },
    "invite-already-on-team": {
      tone: "danger",
      text: t("settings.team.notice.inviteAlreadyOnTeam"),
    },
    "invite-email-taken": { tone: "danger", text: t("settings.team.notice.inviteEmailTaken") },
    "invite-email-reserved": {
      tone: "danger",
      text: t("settings.team.notice.inviteEmailReserved"),
    },
    "contact-saved": { tone: "success", text: t("settings.team.notice.contactSaved") },
    "languages-saved": { tone: "success", text: t("settings.team.notice.languagesSaved") },
    "half-filled": { tone: "danger", text: t("settings.team.notice.contactHalfFilled") },
    "last-owner": { tone: "danger", text: t("settings.team.notice.lastOwner") },
    "not-found": { tone: "danger", text: t("settings.team.notice.notFound") },
    "not-authorized": { tone: "danger", text: t("settings.team.notice.notAuthorized") },
    "credential-saved": { tone: "success", text: t("staffing.notice.credentialSaved") },
    "credential-renewed": { tone: "success", text: t("staffing.notice.credentialRenewed") },
    "credential-corrected": { tone: "success", text: t("staffing.notice.credentialCorrected") },
    "credential-reviewed": { tone: "success", text: t("staffing.notice.credentialReviewed") },
    "credential-deleted": { tone: "success", text: t("staffing.notice.credentialDeleted") },
    "credential-renewal-required": {
      tone: "danger",
      text: t("staffing.notice.credentialRenewalRequired"),
    },
    "credential-invalid": { tone: "danger", text: t("staffing.notice.credentialInvalid") },
  };
}
